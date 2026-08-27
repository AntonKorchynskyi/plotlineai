package com.plotlineai.backend.dataset;

import com.plotlineai.backend.dataset.dto.ColumnSchema;
import com.plotlineai.backend.dataset.dto.DatasetDetailResponse;
import com.plotlineai.backend.dataset.dto.UploadResponse;
import com.plotlineai.backend.error.DatasetNotFoundException;
import com.plotlineai.backend.error.FileTooLargeException;
import com.plotlineai.backend.error.InvalidFileTypeException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

@Service
public class DatasetService {

    private static final TypeReference<List<ColumnSchema>> SCHEMA_LIST =
        new TypeReference<>() {};
    private static final TypeReference<List<List<String>>> ROW_MATRIX =
        new TypeReference<>() {};

    private final DatasetRepository repository;
    private final DatasetCapsProperties caps;
    private final ObjectMapper objectMapper;
    private final CsvParser csvParser;
    private final SchemaInferrer schemaInferrer;

    public DatasetService(
            DatasetRepository repository,
            DatasetCapsProperties caps,
            ObjectMapper objectMapper) {
        this.repository = repository;
        this.caps = caps;
        this.objectMapper = objectMapper;
        this.csvParser = new CsvParser(caps);
        this.schemaInferrer = new SchemaInferrer();
    }

    @Transactional
    public UploadResponse upload(String originalFilename, String contentType, byte[] bytes) {
        validateFileType(originalFilename, contentType);
        if (bytes.length > caps.maxFileBytes()) {
            throw new FileTooLargeException(
                "The file exceeds the maximum of " + caps.maxFileBytes() + " bytes");
        }

        ParsedCsv parsed = csvParser.parse(bytes);
        List<ColumnSchema> schema = schemaInferrer.infer(parsed);

        Instant now = Instant.now();
        Dataset dataset = new Dataset();
        dataset.setId(UUID.randomUUID());
        dataset.setCreatedAt(now);
        dataset.setExpiresAt(now.plus(caps.ttl()));
        dataset.setRowCount(parsed.rows().size());
        dataset.setSchema(objectMapper.valueToTree(schema));
        dataset.setRows(objectMapper.valueToTree(parsed.rows()));
        repository.save(dataset);

        return new UploadResponse(dataset.getId(), schema, dataset.getRowCount());
    }

    @Transactional(readOnly = true)
    public DatasetDetailResponse get(UUID id) {
        Dataset dataset = repository.findById(id)
            .orElseThrow(() -> new DatasetNotFoundException(id));

        List<ColumnSchema> schema = objectMapper.treeToValue(dataset.getSchema(), SCHEMA_LIST);
        List<List<String>> rows = objectMapper.treeToValue(dataset.getRows(), ROW_MATRIX);

        List<String> headers = schema.stream().map(ColumnSchema::name).toList();

        int limit = Math.min(caps.sampleRows(), rows.size());
        List<Map<String, String>> sampleRows = new ArrayList<>(limit);
        for (int r = 0; r < limit; r++) {
            List<String> row = rows.get(r);
            Map<String, String> mapped = new LinkedHashMap<>();
            for (int c = 0; c < headers.size(); c++) {
                mapped.put(headers.get(c), c < row.size() ? row.get(c) : "");
            }
            sampleRows.add(mapped);
        }

        return new DatasetDetailResponse(dataset.getId(), schema, dataset.getRowCount(), sampleRows);
    }

    private void validateFileType(String originalFilename, String contentType) {
        if (contentType == null || !isCsvMediaType(contentType)) {
            throw new InvalidFileTypeException("The upload content type must be text/csv");
        }
        if (originalFilename == null
                || !originalFilename.toLowerCase(Locale.ROOT).endsWith(".csv")) {
            throw new InvalidFileTypeException("The file name must end with .csv");
        }
    }

    private boolean isCsvMediaType(String contentType) {
        String base = contentType.split(";", 2)[0].trim();
        return base.equalsIgnoreCase("text/csv");
    }
}
