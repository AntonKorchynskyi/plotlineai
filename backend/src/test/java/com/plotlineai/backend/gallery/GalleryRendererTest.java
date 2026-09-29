package com.plotlineai.backend.gallery;

import static org.junit.jupiter.api.Assertions.*;

import com.plotlineai.backend.chart.spec.Aggregation;
import com.plotlineai.backend.chart.spec.ChartSpec;
import com.plotlineai.backend.chart.spec.ChartType;
import com.plotlineai.backend.chart.spec.Dimension;
import com.plotlineai.backend.chart.spec.Measure;
import com.plotlineai.backend.dataset.DatasetCapsProperties;
import com.plotlineai.backend.error.InvalidChartSpecException;
import com.plotlineai.backend.gallery.dto.GalleryExampleResponse;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class GalleryRendererTest {

    private final DatasetCapsProperties caps =
        new DatasetCapsProperties(5_242_880L, 100_000, 256, 32_768, Duration.ofDays(1), 20, 0L, 300);

    @Test
    void rendersTheWholeCatalogInDisplayOrder() {
        GalleryRenderer renderer = new GalleryRenderer(caps, JsonMapper.builder().build());

        List<GalleryExampleResponse> examples = renderer.examples();
        assertEquals(6, examples.size());
        assertEquals(List.of("revenue-by-region", "monthly-signups", "traffic-sources",
                "sales-by-category", "price-vs-rating", "city-size-vs-density"),
            examples.stream().map(GalleryExampleResponse::slug).toList());
        assertEquals("/gallery/revenue-by-region/csv", examples.get(0).csvPath());
        assertEquals("bar", examples.get(0).chartType());
        assertFalse(examples.get(0).renderedData().get("labels").isEmpty(), "rendered from the real CSV");
    }

    @Test
    void findsAnEntryBySlug() {
        GalleryRenderer renderer = new GalleryRenderer(caps, JsonMapper.builder().build());
        assertEquals("monthly-signups.csv", renderer.find("monthly-signups").orElseThrow().csvFilename());
        assertTrue(renderer.find("nope").isEmpty());
    }

    @Test
    void anEntryWhoseSpecDoesNotFitItsCsvFailsStartup() {
        var broken = new GalleryCatalog.Entry("broken", "Broken", "d", "revenue-by-region.csv",
            new ChartSpec(ChartType.bar, null, "T", new Dimension("no_such_column", null),
                List.of(new Measure("revenue", Aggregation.sum, "R")), null, null, null, null), 1);

        assertThrows(InvalidChartSpecException.class,
            () -> new GalleryRenderer(List.of(broken), caps, JsonMapper.builder().build()));
    }
}
