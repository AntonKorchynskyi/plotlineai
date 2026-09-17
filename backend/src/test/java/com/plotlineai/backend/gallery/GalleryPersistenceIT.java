package com.plotlineai.backend.gallery;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.plotlineai.backend.TestcontainersConfiguration;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class GalleryPersistenceIT {

    private static final List<String> TEST_SLUGS = List.of("alpha-persist", "zeta-persist");

    @Autowired GalleryExampleRepository repository;
    @Autowired ObjectMapper objectMapper;

    @AfterEach
    void removeTestRows() {
        TEST_SLUGS.forEach(slug -> repository.findBySlug(slug).ifPresent(repository::delete));
    }

    private GalleryExample example(String slug, int order) {
        GalleryExample e = new GalleryExample();
        e.setSlug(slug);
        e.setTitle("Title " + slug);
        e.setDescription("Description " + slug);
        e.setChartType("bar");
        e.setSpec(objectMapper.readTree("{\"chartType\":\"bar\"}"));
        e.setCsvFilename(slug + ".csv");
        e.setRenderedData(objectMapper.readTree("{\"labels\":[\"a\"],\"datasets\":[]}"));
        e.setDisplayOrder(order);
        return e;
    }

    @Test
    void jsonbColumnsRoundTripAndOrderingIsByDisplayOrder() {
        repository.save(example("zeta-persist", 1001));
        repository.save(example("alpha-persist", 1000));

        List<String> slugs = repository.findAllByOrderByDisplayOrderAscSlugAsc().stream()
            .map(GalleryExample::getSlug).toList();
        assertTrue(slugs.indexOf("alpha-persist") < slugs.indexOf("zeta-persist"));

        GalleryExample loaded = repository.findBySlug("alpha-persist").orElseThrow();
        assertEquals("bar", loaded.getSpec().get("chartType").asString());
        assertEquals("a", loaded.getRenderedData().get("labels").get(0).asString());
        assertEquals("alpha-persist.csv", loaded.getCsvFilename());
        assertEquals(1000, loaded.getDisplayOrder());
    }
}
