package com.plotlineai.backend.share;

import com.plotlineai.backend.chart.ChartService;
import com.plotlineai.backend.chart.dto.RenderResponse;
import com.plotlineai.backend.chart.spec.ChartSpec;
import com.plotlineai.backend.error.ShareNotFoundException;
import com.plotlineai.backend.error.ShareTooLargeException;
import com.plotlineai.backend.events.EventPublisher;
import com.plotlineai.backend.share.dto.CreateShareResponse;
import com.plotlineai.backend.share.dto.ShareResponse;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Service
public class ShareService {

    /** Leaves room under DynamoDB's 400 KB item limit for the key, spec and timestamps. */
    static final int MAX_SNAPSHOT_BYTES = 350 * 1024;

    private final ShareStore store;
    private final ChartService chartService;
    private final ObjectMapper objectMapper;
    private final EventPublisher events;

    public ShareService(ShareStore store, ChartService chartService, ObjectMapper objectMapper,
            EventPublisher events) {
        this.store = store;
        this.chartService = chartService;
        this.objectMapper = objectMapper;
        this.events = events;
    }

    /**
     * Renders the snapshot server-side, so nothing client-supplied is persisted and the share
     * keeps working after the dataset expires.
     */
    public CreateShareResponse create(UUID datasetId, ChartSpec spec) {
        RenderResponse rendered = chartService.render(datasetId, spec);
        byte[] snapshot = gzip(objectMapper.writeValueAsBytes(rendered));
        if (snapshot.length > MAX_SNAPSHOT_BYTES) {
            throw new ShareTooLargeException();
        }

        UUID id = UUID.randomUUID();
        store.save(id, Instant.now(), objectMapper.writeValueAsString(spec), snapshot);
        events.publish("share.created", Map.of("chartType", rendered.chartType(), "snapshotBytes", snapshot.length));
        return new CreateShareResponse(id);
    }

    public ShareResponse get(UUID shareId) {
        ShareStore.StoredShare share = store.find(shareId).orElseThrow(ShareNotFoundException::new);
        return new ShareResponse(share.id(), share.createdAt(), gunzip(share.snapshotGz()));
    }

    private JsonNode gunzip(byte[] gz) {
        try (InputStream in = new GZIPInputStream(new ByteArrayInputStream(gz))) {
            return objectMapper.readTree(in);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static byte[] gzip(byte[] bytes) {
        var out = new ByteArrayOutputStream(bytes.length / 4 + 64);
        try (var gz = new GZIPOutputStream(out)) {
            gz.write(bytes);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return out.toByteArray();
    }
}
