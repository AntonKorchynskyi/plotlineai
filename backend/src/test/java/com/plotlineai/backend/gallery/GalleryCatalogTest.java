package com.plotlineai.backend.gallery;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.plotlineai.backend.chart.spec.ChartType;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

class GalleryCatalogTest {

    static Stream<GalleryCatalog.Entry> entries() {
        return GalleryCatalog.ENTRIES.stream();
    }

    @Test
    void hasSixEntriesWithUniqueSlugsAndSequentialOrder() {
        assertEquals(6, GalleryCatalog.ENTRIES.size());

        Set<String> slugs = new HashSet<>();
        for (GalleryCatalog.Entry e : GalleryCatalog.ENTRIES) {
            assertTrue(slugs.add(e.slug()), "duplicate slug: " + e.slug());
        }

        List<Integer> orders = GalleryCatalog.ENTRIES.stream()
            .map(GalleryCatalog.Entry::displayOrder).sorted().toList();
        assertEquals(List.of(1, 2, 3, 4, 5, 6), orders);
    }

    @Test
    void coversTheChartTypeRange() {
        Set<ChartType> types = new HashSet<>();
        GalleryCatalog.ENTRIES.forEach(e -> types.add(e.spec().chartType()));
        assertTrue(types.containsAll(Set.of(ChartType.bar, ChartType.line,
            ChartType.doughnut, ChartType.scatter, ChartType.bubble)),
            "gallery should showcase the chart range, saw " + types);
        assertTrue(GalleryCatalog.ENTRIES.stream()
            .anyMatch(e -> Boolean.TRUE.equals(e.spec().stacked()) && e.spec().breakdown() != null),
            "gallery should include a stacked chart with a breakdown");
    }

    @ParameterizedTest
    @MethodSource("entries")
    void csvFileExistsOnClasspathWithHeaderAndRows(GalleryCatalog.Entry entry) throws Exception {
        String path = GalleryCatalog.CSV_CLASSPATH_DIR + entry.csvFilename();
        try (InputStream in = GalleryCatalogTest.class.getClassLoader().getResourceAsStream(path)) {
            assertNotNull(in, "missing classpath resource: " + path);
            List<String> lines = new String(in.readAllBytes(), StandardCharsets.UTF_8)
                .lines().filter(l -> !l.isBlank()).toList();
            assertTrue(lines.size() >= 5, path + " should have a header and several rows");
            assertTrue(lines.get(0).contains(","), path + " header should be comma separated");
        }
    }

    @ParameterizedTest
    @MethodSource("entries")
    void metadataIsPresentable(GalleryCatalog.Entry entry) {
        assertTrue(entry.title() != null && !entry.title().isBlank());
        assertTrue(entry.description() != null && !entry.description().isBlank());
        assertTrue(entry.csvFilename().endsWith(".csv"));
        assertTrue(entry.slug().matches("[a-z0-9]+(-[a-z0-9]+)*"), "slug must be url-safe");
        assertEquals(entry.spec().title(), entry.title(),
            "the chart title should match the card title so the rendered snapshot agrees");
    }
}
