package com.plotlineai.backend.gallery;

import com.plotlineai.backend.chart.spec.Aggregation;
import com.plotlineai.backend.chart.spec.Breakdown;
import com.plotlineai.backend.chart.spec.ChartSpec;
import com.plotlineai.backend.chart.spec.ChartType;
import com.plotlineai.backend.chart.spec.Dimension;
import com.plotlineai.backend.chart.spec.Measure;
import com.plotlineai.backend.chart.spec.Sort;
import com.plotlineai.backend.chart.spec.SortBy;
import com.plotlineai.backend.chart.spec.SortDirection;
import com.plotlineai.backend.chart.spec.TimeBucket;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.List;

/**
 * The curated landing-page examples. Content lives here rather than in SQL so the seeder can
 * render each one through the real aggregation engine.
 */
public final class GalleryCatalog {

    public static final String CSV_CLASSPATH_DIR = "gallery/";

    public record Entry(String slug, String title, String description,
            String csvFilename, ChartSpec spec, int displayOrder) {
    }

    public static final List<Entry> ENTRIES = List.of(
        new Entry(
            "revenue-by-region",
            "Revenue by region",
            "Total sales revenue per region, ranked highest first.",
            "revenue-by-region.csv",
            new ChartSpec(ChartType.bar, null, "Revenue by region",
                new Dimension("region", null),
                List.of(new Measure("revenue", Aggregation.sum, "Revenue")),
                null, null,
                new Sort(SortBy.measure, SortDirection.desc), null),
            1),
        new Entry(
            "monthly-signups",
            "Signups per month",
            "New account signups aggregated by month across the year.",
            "monthly-signups.csv",
            new ChartSpec(ChartType.line, null, "Signups per month",
                new Dimension("date", TimeBucket.month),
                List.of(new Measure("signups", Aggregation.sum, "Signups")),
                null, null, null, null),
            2),
        new Entry(
            "traffic-sources",
            "Traffic by source",
            "Share of sessions contributed by each acquisition channel.",
            "traffic-sources.csv",
            new ChartSpec(ChartType.doughnut, null, "Traffic by source",
                new Dimension("source", null),
                List.of(new Measure("sessions", Aggregation.sum, "Sessions")),
                null, null,
                new Sort(SortBy.measure, SortDirection.desc), null),
            3),
        new Entry(
            "sales-by-category",
            "Sales by category per quarter",
            "Quarterly sales stacked by product category.",
            "sales-by-category.csv",
            new ChartSpec(ChartType.bar, true, "Sales by category per quarter",
                new Dimension("date", TimeBucket.quarter),
                List.of(new Measure("sales", Aggregation.sum, "Sales")),
                new Breakdown("category"), null, null, null),
            4),
        new Entry(
            "price-vs-rating",
            "Price against rating",
            "Every product plotted by list price and average customer rating.",
            "price-vs-rating.csv",
            new ChartSpec(ChartType.scatter, null, "Price against rating",
                new Dimension("product", null),
                List.of(new Measure("price", Aggregation.none, "Price"),
                        new Measure("rating", Aggregation.none, "Rating")),
                null, null, null, null),
            5),
        new Entry(
            "city-size-vs-density",
            "City size against density",
            "City area against population, sized by people per square kilometre.",
            "city-size-vs-density.csv",
            new ChartSpec(ChartType.bubble, null, "City size against density",
                new Dimension("city", null),
                List.of(new Measure("area_km2", Aggregation.none, "Area (km2)"),
                        new Measure("population_k", Aggregation.none, "Population (k)"),
                        new Measure("density_per_km2", Aggregation.none, "Density")),
                null, null, null, null),
            6));

    /**
     * Reads one of the curated CSVs from the classpath. A missing file is a server-side
     * configuration problem, not something a caller can recover from, so this throws rather
     * than returning an empty result.
     */
    public static byte[] readCsv(String csvFilename) {
        String path = CSV_CLASSPATH_DIR + csvFilename;
        try (InputStream in = GalleryCatalog.class.getClassLoader().getResourceAsStream(path)) {
            if (in == null) {
                throw new IllegalStateException("Missing gallery CSV on classpath: " + path);
            }
            return in.readAllBytes();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private GalleryCatalog() {
    }
}
