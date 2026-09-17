package com.plotlineai.backend.gallery;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.plotlineai.backend.TestcontainersConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import tools.jackson.databind.JsonNode;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class GallerySeederIT {

    @Autowired GalleryExampleRepository repository;
    @Autowired GallerySeeder seeder;

    private JsonNode rendered(String slug) {
        return repository.findBySlug(slug).orElseThrow().getRenderedData();
    }

    @Test
    void startupSeedsEveryCatalogEntryWithRenderedData() {
        // The seeder already ran as an ApplicationRunner during context startup.
        for (GalleryCatalog.Entry entry : GalleryCatalog.ENTRIES) {
            GalleryExample row = repository.findBySlug(entry.slug()).orElseThrow();
            assertEquals(entry.title(), row.getTitle());
            assertEquals(entry.description(), row.getDescription());
            assertEquals(entry.csvFilename(), row.getCsvFilename());
            assertEquals(entry.spec().chartType().name(), row.getChartType());
            assertEquals(entry.displayOrder(), row.getDisplayOrder());
            assertEquals(entry.spec().chartType().name(), row.getSpec().get("chartType").asString());

            JsonNode rendered = row.getRenderedData();
            assertEquals(entry.title(), rendered.get("title").asString());
            assertFalse(rendered.get("datasets").isEmpty(),
                entry.slug() + " should have at least one series");
        }
    }

    @Test
    void barExampleAggregatesAndRanksRealNumbers() {
        JsonNode r = rendered("revenue-by-region");
        // sum(revenue) sorted by measure desc:
        // North America 366350, Asia Pacific 339550, Europe 274650,
        // Latin America 116100, Middle East 47200
        assertEquals(5, r.get("labels").size());
        assertEquals("North America", r.get("labels").get(0).asString());
        assertEquals("Middle East", r.get("labels").get(4).asString());
        assertEquals(366350.0, r.get("datasets").get(0).get("data").get(0).asDouble());
        assertEquals(47200.0, r.get("datasets").get(0).get("data").get(4).asDouble());
    }

    @Test
    void lineExampleBucketsByMonth() {
        JsonNode r = rendered("monthly-signups");
        assertEquals(11, r.get("labels").size());                 // Jan through Nov 2024
        assertEquals("2024-01", r.get("labels").get(0).asString());
        assertEquals(310.0, r.get("datasets").get(0).get("data").get(0).asDouble()); // 142 + 168
    }

    @Test
    void stackedExampleProducesOneSeriesPerCategory() {
        JsonNode r = rendered("sales-by-category");
        assertTrue(r.get("stacked").asBoolean());
        assertEquals(4, r.get("labels").size());                  // four quarters
        assertEquals("2024-Q1", r.get("labels").get(0).asString());
        assertEquals(3, r.get("datasets").size());                // Hardware, Services, Software
        assertEquals("Hardware", r.get("datasets").get(0).get("label").asString());
        assertEquals(164000.0, r.get("datasets").get(0).get("data").get(0).asDouble()); // 84200 + 79800
    }

    @Test
    void scatterAndBubbleExamplesEmitPointObjects() {
        JsonNode scatter = rendered("price-vs-rating").get("datasets").get(0).get("data").get(0);
        assertEquals(24.99, scatter.get("x").asDouble());
        assertEquals(3.8, scatter.get("y").asDouble());

        JsonNode bubble = rendered("city-size-vs-density").get("datasets").get(0).get("data").get(0);
        assertEquals(101.0, bubble.get("x").asDouble());
        assertEquals(1620.0, bubble.get("y").asDouble());
        assertEquals(16040.0, bubble.get("r").asDouble());
    }

    @Test
    void seedingIsIdempotent() {
        long before = repository.count();
        assertEquals(GalleryCatalog.ENTRIES.size(), seeder.seed());
        assertEquals(GalleryCatalog.ENTRIES.size(), seeder.seed());
        assertEquals(before, repository.count(), "re-seeding must upsert, not duplicate");
    }
}
