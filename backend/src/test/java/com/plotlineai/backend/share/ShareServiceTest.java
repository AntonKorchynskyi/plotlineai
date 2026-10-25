package com.plotlineai.backend.share;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.plotlineai.backend.chart.ChartService;
import com.plotlineai.backend.chart.dto.RenderResponse;
import com.plotlineai.backend.chart.spec.Aggregation;
import com.plotlineai.backend.chart.spec.ChartSpec;
import com.plotlineai.backend.chart.spec.ChartType;
import com.plotlineai.backend.chart.spec.Dimension;
import com.plotlineai.backend.chart.spec.Measure;
import com.plotlineai.backend.error.ShareTooLargeException;
import com.plotlineai.backend.events.EventPublisher;
import com.plotlineai.backend.insight.InsightService;
import com.plotlineai.backend.share.dto.ShareResponse;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.UUID;
import java.util.Optional;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

class ShareServiceTest {

    private final ObjectMapper objectMapper = JsonMapper.builder().build();
    private final ChartService charts = mock(ChartService.class);
    private final ShareStore store = mock(ShareStore.class);
    private final EventPublisher events = mock(EventPublisher.class);
    private final InsightService insights = mock(InsightService.class);
    private final ShareService service = new ShareService(store, charts, objectMapper, events, insights);

    private final UUID datasetId = UUID.randomUUID();
    private final ChartSpec spec = new ChartSpec(ChartType.bar, null, "T", new Dimension("d", null),
        List.of(new Measure("m", Aggregation.sum, "M")), null, null, null, null);

    @Test
    void storesTheRenderedSnapshotCompressed() throws Exception {
        RenderResponse rendered = new RenderResponse("bar", false, "T", List.of("a", "b"),
            List.of(new RenderResponse.Series("M", List.of(1, 2))));
        when(charts.render(datasetId, spec)).thenReturn(rendered);

        service.create(datasetId, spec);

        ArgumentCaptor<byte[]> snapshot = ArgumentCaptor.forClass(byte[].class);
        verify(store).save(any(), any(), any(), snapshot.capture(), any());
        byte[] json = new GZIPInputStream(new ByteArrayInputStream(snapshot.getValue())).readAllBytes();
        assertArrayEquals(objectMapper.writeValueAsBytes(rendered), json);
    }

    @Test
    void refusesASnapshotOverTheCapAndStoresNothing() {
        // Random labels barely compress, so 20,000 of 40 characters stay far above 350 KB gzipped.
        Random random = new Random(42);
        List<String> labels = new ArrayList<>();
        for (int i = 0; i < 20_000; i++) {
            StringBuilder label = new StringBuilder();
            for (int c = 0; c < 40; c++) label.append((char) ('!' + random.nextInt(90)));
            labels.add(label.toString());
        }
        when(charts.render(datasetId, spec)).thenReturn(new RenderResponse("bar", false, "T", labels, List.of()));

        assertThrows(ShareTooLargeException.class, () -> service.create(datasetId, spec));
        verify(store, never()).save(any(), any(), any(), any(), any());
    }

    @Test
    void copiesTheDatasetsStoredInsightsIntoTheShare() {
        when(charts.render(datasetId, spec)).thenReturn(rendered());
        when(insights.storedOrNone(datasetId)).thenReturn(List.of("North leads with 40.5.", "South trails."));

        service.create(datasetId, spec);

        verify(store).save(any(), any(), any(), any(), eq(
            "[\"North leads with 40.5.\",\"South trails.\"]"));
    }

    @Test
    void storesAnEmptyListWhenTheInsightsAreNotReady() {
        when(charts.render(datasetId, spec)).thenReturn(rendered());
        when(insights.storedOrNone(datasetId)).thenReturn(List.of());

        service.create(datasetId, spec);

        verify(store).save(any(), any(), any(), any(), eq("[]"));
    }

    @Test
    void readsTheInsightsBack() throws Exception {
        UUID shareId = UUID.randomUUID();
        when(store.find(shareId)).thenReturn(Optional.of(new ShareStore.StoredShare(shareId, Instant.EPOCH,
            gzip(objectMapper.writeValueAsBytes(rendered())), "[\"North leads.\"]")));

        ShareResponse share = service.get(shareId);

        assertEquals(List.of("North leads."), share.insights());
    }

    private static RenderResponse rendered() {
        return new RenderResponse("bar", false, "T", List.of("a"), List.of(new RenderResponse.Series("M", List.of(1))));
    }

    private static byte[] gzip(byte[] bytes) throws Exception {
        var out = new ByteArrayOutputStream();
        try (var gz = new GZIPOutputStream(out)) {
            gz.write(bytes);
        }
        return out.toByteArray();
    }
}
