package com.plotlineai.backend.dataset;

import com.plotlineai.backend.dataset.dto.ColumnSchema;
import com.plotlineai.backend.dataset.dto.CreateUploadRequest;
import com.plotlineai.backend.dataset.dto.CreateUploadResponse;
import com.plotlineai.backend.dataset.dto.DatasetDetailResponse;
import com.plotlineai.backend.dataset.dto.UploadResponse;
import com.plotlineai.backend.error.CapExceededException;
import com.plotlineai.backend.error.CsvParseException;
import com.plotlineai.backend.error.DatasetNotFoundException;
import com.plotlineai.backend.error.FileTooLargeException;
import com.plotlineai.backend.error.InvalidFileTypeException;
import com.plotlineai.backend.error.InvalidRequestException;
import com.plotlineai.backend.error.UploadQuotaReachedException;
import com.plotlineai.backend.events.EventPublisher;
import com.plotlineai.backend.quota.UploadQuota;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * Uploads happen in two calls around a direct browser-to-S3 PUT: {@link #presign} checks what
 * the browser declares and hands out a URL for exactly that file, and {@link #finalizeUpload}
 * parses what arrived. Large bodies never pass through the api or Lambda.
 */
@Service
public class DatasetService {

    private final DatasetStore datasets;
    private final UploadStore uploads;
    private final UploadQuota uploadQuota;
    private final DatasetCapsProperties caps;
    private final EventPublisher events;
    private final CsvParser csvParser;
    private final SchemaInferrer schemaInferrer;

    public DatasetService(DatasetStore datasets, UploadStore uploads, UploadQuota uploadQuota,
            DatasetCapsProperties caps, EventPublisher events) {
        this.datasets = datasets;
        this.uploads = uploads;
        this.uploadQuota = uploadQuota;
        this.caps = caps;
        this.events = events;
        this.csvParser = new CsvParser(caps);
        this.schemaInferrer = new SchemaInferrer();
    }

    /** Checks come before the quota, so a request that would be refused anyway spends nothing. */
    public CreateUploadResponse presign(CreateUploadRequest request) {
        if (!StringUtils.hasText(request.filename()) || !StringUtils.hasText(request.contentType())
                || request.size() == null) {
            throw new InvalidRequestException("filename, contentType and size are required");
        }
        validateFileType(request.filename(), request.contentType());
        if (request.size() <= 0) {
            throw new InvalidRequestException("The file is empty");
        }
        if (request.size() > caps.maxFileBytes()) {
            throw new FileTooLargeException("The file exceeds the maximum of " + caps.maxFileBytes() + " bytes");
        }
        if (!uploadQuota.tryConsume(LocalDate.now(ZoneOffset.UTC))) {
            throw new UploadQuotaReachedException();
        }

        UUID uploadId = UUID.randomUUID();
        UploadStore.PresignedUpload presigned = uploads.presign(uploadId, "text/csv", request.size());
        return new CreateUploadResponse(uploadId, presigned.url(), presigned.headers(),
            UploadStore.URL_LIFETIME.toSeconds());
    }

    public UploadResponse finalizeUpload(UUID uploadId) {
        if (uploadId == null) {
            throw new InvalidRequestException("uploadId is required");
        }
        byte[] bytes = uploads.read(uploadId, caps.maxFileBytes());

        long parseStart = System.nanoTime();
        ParsedCsv parsed = parse(bytes);
        List<ColumnSchema> schema = schemaInferrer.infer(parsed);
        long parseMs = (System.nanoTime() - parseStart) / 1_000_000;

        Instant now = Instant.now();
        DatasetRecord record = new DatasetRecord(UUID.randomUUID(), parsed.rows().size(), schema.size(),
            bytes.length, now, now.plus(caps.ttl()));
        datasets.save(record, new DatasetStore.Detail(schema, sampleRows(schema, parsed.rows())), parsed.rows());
        // Only once the dataset is safely stored: a failed save leaves the upload for a retry.
        uploads.delete(uploadId);

        events.publish("dataset.uploaded", uploadedEvent(record, parsed, schema, parseMs));
        return new UploadResponse(record.id(), schema, record.rowCount());
    }

    /** Parses the upload, reporting a refusal by its fixed reason code before it propagates. */
    private ParsedCsv parse(byte[] bytes) {
        try {
            return csvParser.parse(bytes);
        } catch (CsvParseException e) {
            events.publish("dataset.rejected", Map.of("reason", e.reason(), "bytes", bytes.length));
            throw e;
        } catch (CapExceededException e) {
            events.publish("dataset.rejected", Map.of("reason", e.reason(), "bytes", bytes.length));
            throw e;
        }
    }

    /**
     * What shape the file had: column counts by type, the delimiter and encoding, how many
     * columns needed a number format. Never a column name or a cell value: either can be
     * personal data.
     */
    private static Map<String, Object> uploadedEvent(DatasetRecord record, ParsedCsv parsed,
            List<ColumnSchema> schema, long parseMs) {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("rowCount", record.rowCount());
        fields.put("columnCount", record.columnCount());
        fields.put("bytes", record.bytes());
        fields.put("parseMs", parseMs);
        fields.put("integerColumns", count(schema, ColumnType.INTEGER));
        fields.put("decimalColumns", count(schema, ColumnType.DECIMAL));
        fields.put("dateColumns", count(schema, ColumnType.DATE));
        fields.put("booleanColumns", count(schema, ColumnType.BOOLEAN));
        fields.put("textColumns", count(schema, ColumnType.STRING));
        fields.put("formattedNumberColumns",
            schema.stream().filter(c -> NumberFormats.isLabel(c.format())).count());
        fields.put("missingCells", schema.stream().mapToLong(ColumnSchema::nullCount).sum());
        fields.put("delimiter", switch (parsed.delimiter()) {
            case ';' -> "semicolon";
            case '\t' -> "tab";
            case '|' -> "pipe";
            default -> "comma";
        });
        fields.put("encoding", parsed.encoding());
        return fields;
    }

    private static long count(List<ColumnSchema> schema, ColumnType type) {
        return schema.stream().filter(c -> c.type() == type).count();
    }

    public DatasetDetailResponse get(UUID id) {
        DatasetRecord record = datasets.findLive(id, Instant.now())
            .orElseThrow(() -> new DatasetNotFoundException(id));
        DatasetStore.Detail detail = datasets.readDetail(id);
        return new DatasetDetailResponse(id, detail.schema(), record.rowCount(), detail.sampleRows());
    }

    private List<Map<String, String>> sampleRows(List<ColumnSchema> schema, List<List<String>> rows) {
        List<String> headers = schema.stream().map(ColumnSchema::name).toList();
        int limit = Math.min(caps.sampleRows(), rows.size());
        List<Map<String, String>> sample = new ArrayList<>(limit);
        for (int r = 0; r < limit; r++) {
            List<String> row = rows.get(r);
            Map<String, String> mapped = new LinkedHashMap<>();
            for (int c = 0; c < headers.size(); c++) {
                String cell = c < row.size() ? row.get(c) : null;
                mapped.put(headers.get(c), cell != null ? cell : "");
            }
            sample.add(mapped);
        }
        return sample;
    }

    private void validateFileType(String filename, String contentType) {
        if (!isCsvMediaType(contentType)) {
            throw new InvalidFileTypeException("The upload content type must be text/csv");
        }
        if (!filename.toLowerCase(Locale.ROOT).endsWith(".csv")) {
            throw new InvalidFileTypeException("The file name must end with .csv");
        }
    }

    private boolean isCsvMediaType(String contentType) {
        String base = contentType.split(";", 2)[0].trim();
        return base.equalsIgnoreCase("text/csv");
    }
}
