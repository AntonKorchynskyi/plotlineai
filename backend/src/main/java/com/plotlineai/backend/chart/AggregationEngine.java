package com.plotlineai.backend.chart;

import com.plotlineai.backend.chart.dto.RenderResponse;
import com.plotlineai.backend.chart.dto.RenderResponse.Series;
import com.plotlineai.backend.chart.spec.Aggregation;
import com.plotlineai.backend.chart.spec.ChartSpec;
import com.plotlineai.backend.chart.spec.ChartType;
import com.plotlineai.backend.chart.spec.Filter;
import com.plotlineai.backend.chart.spec.FilterOp;
import com.plotlineai.backend.chart.spec.Measure;
import com.plotlineai.backend.chart.spec.SortBy;
import com.plotlineai.backend.chart.spec.SortDirection;
import com.plotlineai.backend.chart.spec.TimeBucket;
import com.plotlineai.backend.dataset.ColumnType;
import com.plotlineai.backend.dataset.DateFormats;
import com.plotlineai.backend.dataset.dto.ColumnSchema;
import com.plotlineai.backend.error.InvalidChartSpecException;
import java.math.BigDecimal;
import java.math.MathContext;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.SortedMap;
import java.util.TreeMap;
import tools.jackson.databind.JsonNode;

public class AggregationEngine {

    private static final int MAX_GROUPS = 1000;

    private static final Set<FilterOp> ORDERED_OPS =
        EnumSet.of(FilterOp.gt, FilterOp.gte, FilterOp.lt, FilterOp.lte);

    public record Point(double x, double y) {
    }

    public record BubblePoint(double x, double y, double r) {
    }

    private static final int MAX_POINTS = 5000;

    public RenderResponse render(ChartSpec spec, List<ColumnSchema> schema, List<List<String>> rows) {
        Map<String, Integer> index = new HashMap<>();
        Map<String, ColumnSchema> cols = new HashMap<>();
        for (int i = 0; i < schema.size(); i++) {
            ColumnSchema col = schema.get(i);
            if (!index.containsKey(col.name())) {
                index.put(col.name(), i);
                cols.put(col.name(), col);
            }
        }

        List<List<String>> filtered = applyFilters(spec.filters(), rows, index, cols);

        if (spec.chartType() == ChartType.scatter || spec.chartType() == ChartType.bubble) {
            return renderPoints(spec, filtered, index);
        }
        return renderAggregated(spec, filtered, index, cols);
    }

    // --- filtering ---

    private List<List<String>> applyFilters(List<Filter> filters, List<List<String>> rows,
            Map<String, Integer> index, Map<String, ColumnSchema> cols) {
        if (filters == null || filters.isEmpty()) {
            return rows;
        }
        // Parse each ordered filter's comparand once, before the row loop. Otherwise a date
        // comparand that only matches via the ISO fallback constructs and discards a
        // DateTimeParseException on every row. Unparseable values still raise
        // InvalidChartSpecException, exactly as the per-row parse did.
        Map<Filter, Comparable<?>> bounds = new HashMap<>();
        for (Filter filter : filters) {
            if (!ORDERED_OPS.contains(filter.op())) {
                continue;
            }
            ColumnSchema col = cols.get(filter.column());
            bounds.put(filter, col.type() == ColumnType.DATE
                ? ChartSpecValidator.parseFilterDate(scalar(filter.value()), col.format())
                : ChartSpecValidator.parseFilterNumber(scalar(filter.value())));
        }
        List<List<String>> kept = new ArrayList<>();
        for (List<String> row : rows) {
            boolean matchesAll = true;
            for (Filter filter : filters) {
                if (!matches(filter, row, index, cols, bounds.get(filter))) {
                    matchesAll = false;
                    break;
                }
            }
            if (matchesAll) {
                kept.add(row);
            }
        }
        return kept;
    }

    private boolean matches(Filter filter, List<String> row, Map<String, Integer> index,
            Map<String, ColumnSchema> cols, Comparable<?> bound) {
        String raw = cell(row, index.get(filter.column())).trim();
        return switch (filter.op()) {
            case eq -> raw.equals(scalar(filter.value()));
            case neq -> !raw.equals(scalar(filter.value()));
            case in -> containsRaw(filter.value(), raw);
            case gt, gte, lt, lte -> orderedMatch(filter, raw, cols.get(filter.column()), bound);
        };
    }

    private static boolean containsRaw(JsonNode array, String raw) {
        for (JsonNode element : array) {
            if (raw.equals(element.asString())) {
                return true;
            }
        }
        return false;
    }

    private boolean orderedMatch(Filter filter, String raw, ColumnSchema col, Comparable<?> bound) {
        if (raw.isEmpty()) {
            return false;
        }
        int cmp;
        if (col.type() == ColumnType.DATE) {
            LocalDate cellDate;
            try {
                cellDate = DateFormats.parseDate(raw, col.format());
            } catch (DateTimeParseException e) {
                return false;
            }
            cmp = cellDate.compareTo((LocalDate) bound);
        } else {
            BigDecimal cellNumber;
            try {
                cellNumber = new BigDecimal(raw);
            } catch (NumberFormatException e) {
                return false;
            }
            cmp = cellNumber.compareTo((BigDecimal) bound);
        }
        return switch (filter.op()) {
            case gt -> cmp > 0;
            case gte -> cmp >= 0;
            case lt -> cmp < 0;
            case lte -> cmp <= 0;
            default -> throw new IllegalStateException("not an ordered op");
        };
    }

    private static String scalar(JsonNode value) {
        return value.asString();
    }

    // --- aggregated charts ---

    private record GroupKey(Comparable<?> sortKey, String label) {

        @SuppressWarnings("unchecked")
        static final Comparator<GroupKey> BY_KEY = Comparator
            .comparing((GroupKey k) -> (Comparable<Object>) k.sortKey())
            .thenComparing(GroupKey::label);
    }

    private RenderResponse renderAggregated(ChartSpec spec, List<List<String>> rows,
            Map<String, Integer> index, Map<String, ColumnSchema> cols) {
        int dimIndex = index.get(spec.dimension().column());
        ColumnSchema dimCol = cols.get(spec.dimension().column());

        Map<GroupKey, List<List<String>>> groups = new LinkedHashMap<>();
        for (List<String> row : rows) {
            GroupKey key = groupKey(cell(row, dimIndex).trim(), dimCol, spec.dimension().bucket());
            if (key == null) {
                continue;
            }
            groups.computeIfAbsent(key, k -> new ArrayList<>()).add(row);
            if (groups.size() > MAX_GROUPS) {
                throw new InvalidChartSpecException(
                    "The chart would produce too many groups; add a bucket, filter, or limit");
            }
        }

        List<GroupKey> ordered = new ArrayList<>(groups.keySet());
        Map<GroupKey, Double> sortValues;

        if (spec.breakdown() == null) {
            sortValues = measureValues(spec.measures().get(0), groups, index);
            ordered.sort(orderComparator(spec, sortValues));
            List<String> labels = ordered.stream().map(GroupKey::label).toList();
            List<Series> datasets = new ArrayList<>();
            for (Measure measure : spec.measures()) {
                Map<GroupKey, Double> values = measure == spec.measures().get(0)
                    ? sortValues : measureValues(measure, groups, index);
                List<Object> data = new ArrayList<>(ordered.size());
                for (GroupKey key : ordered) {
                    data.add(values.get(key));
                }
                datasets.add(new Series(seriesLabel(measure), data));
            }
            return response(spec, applyLimit(spec, labels), limitSeries(spec, datasets));
        }

        // breakdown: single measure (validator-enforced), one series per breakdown value
        int breakdownIndex = index.get(spec.breakdown().column());
        Measure measure = spec.measures().get(0);
        SortedMap<String, Map<GroupKey, List<List<String>>>> bySeries = new TreeMap<>();
        for (Map.Entry<GroupKey, List<List<String>>> group : groups.entrySet()) {
            for (List<String> row : group.getValue()) {
                String seriesKey = cell(row, breakdownIndex).trim();
                if (seriesKey.isEmpty()) {
                    continue;
                }
                bySeries.computeIfAbsent(seriesKey, k -> new HashMap<>())
                    .computeIfAbsent(group.getKey(), k -> new ArrayList<>())
                    .add(row);
            }
        }

        Map<String, Map<GroupKey, Double>> seriesValues = new LinkedHashMap<>();
        for (Map.Entry<String, Map<GroupKey, List<List<String>>>> entry : bySeries.entrySet()) {
            Map<GroupKey, Double> values = new HashMap<>();
            for (Map.Entry<GroupKey, List<List<String>>> group : entry.getValue().entrySet()) {
                values.put(group.getKey(), aggregate(measure, group.getValue(), index));
            }
            seriesValues.put(entry.getKey(), values);
        }

        sortValues = new HashMap<>();
        for (GroupKey key : groups.keySet()) {
            double totalValue = 0;
            boolean any = false;
            for (Map<GroupKey, Double> values : seriesValues.values()) {
                Double v = values.get(key);
                if (v != null) {
                    totalValue += v;
                    any = true;
                }
            }
            sortValues.put(key, any ? totalValue : null);
        }
        ordered.sort(orderComparator(spec, sortValues));

        List<String> labels = ordered.stream().map(GroupKey::label).toList();
        List<Series> datasets = new ArrayList<>();
        for (Map.Entry<String, Map<GroupKey, Double>> entry : seriesValues.entrySet()) {
            List<Object> data = new ArrayList<>(ordered.size());
            for (GroupKey key : ordered) {
                data.add(entry.getValue().get(key));
            }
            datasets.add(new Series(entry.getKey(), data));
        }
        return response(spec, applyLimit(spec, labels), limitSeries(spec, datasets));
    }

    private Map<GroupKey, Double> measureValues(Measure measure,
            Map<GroupKey, List<List<String>>> groups, Map<String, Integer> index) {
        Map<GroupKey, Double> values = new HashMap<>();
        for (Map.Entry<GroupKey, List<List<String>>> group : groups.entrySet()) {
            values.put(group.getKey(), aggregate(measure, group.getValue(), index));
        }
        return values;
    }

    private Comparator<GroupKey> orderComparator(ChartSpec spec, Map<GroupKey, Double> sortValues) {
        Comparator<GroupKey> comparator;
        if (spec.sort() != null && spec.sort().by() == SortBy.measure) {
            comparator = Comparator.comparingDouble(key -> {
                Double v = sortValues.get(key);
                return v != null ? v : Double.NEGATIVE_INFINITY;
            });
            comparator = comparator.thenComparing(GroupKey.BY_KEY);
        } else {
            comparator = GroupKey.BY_KEY;
        }
        if (spec.sort() != null && spec.sort().direction() == SortDirection.desc) {
            comparator = comparator.reversed();
        }
        return comparator;
    }

    private List<String> applyLimit(ChartSpec spec, List<String> labels) {
        if (spec.limit() == null || labels.size() <= spec.limit()) {
            return labels;
        }
        return labels.subList(0, spec.limit());
    }

    private List<Series> limitSeries(ChartSpec spec, List<Series> datasets) {
        if (spec.limit() == null) {
            return datasets;
        }
        List<Series> limited = new ArrayList<>(datasets.size());
        for (Series series : datasets) {
            List<Object> data = series.data().size() > spec.limit()
                ? series.data().subList(0, spec.limit()) : series.data();
            limited.add(new Series(series.label(), data));
        }
        return limited;
    }

    private RenderResponse response(ChartSpec spec, List<String> labels, List<Series> datasets) {
        return new RenderResponse(spec.chartType().name(),
            Boolean.TRUE.equals(spec.stacked()), spec.title(), labels, datasets);
    }

    private GroupKey groupKey(String raw, ColumnSchema col, TimeBucket bucket) {
        if (raw.isEmpty()) {
            return null;
        }
        if (col.type() == ColumnType.DATE) {
            LocalDate date;
            try {
                date = DateFormats.parseDate(raw, col.format());
            } catch (DateTimeParseException e) {
                return null;
            }
            if (bucket == null) {
                return new GroupKey(date, raw);
            }
            LocalDate start = bucketStart(date, bucket);
            return new GroupKey(start, bucketLabel(start, bucket));
        }
        if (col.type() == ColumnType.INTEGER || col.type() == ColumnType.DECIMAL) {
            try {
                return new GroupKey(new BigDecimal(raw), raw);
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return new GroupKey(raw, raw);
    }

    static LocalDate bucketStart(LocalDate date, TimeBucket bucket) {
        return switch (bucket) {
            case day -> date;
            case week -> date.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
            case month -> date.withDayOfMonth(1);
            case quarter -> date.withMonth(((date.getMonthValue() - 1) / 3) * 3 + 1).withDayOfMonth(1);
            case year -> date.withDayOfYear(1);
        };
    }

    static String bucketLabel(LocalDate start, TimeBucket bucket) {
        return switch (bucket) {
            case day, week -> start.toString();
            case month -> String.format(
                Locale.ROOT, "%04d-%02d", start.getYear(), start.getMonthValue());
            case quarter -> start.getYear() + "-Q" + ((start.getMonthValue() - 1) / 3 + 1);
            case year -> String.valueOf(start.getYear());
        };
    }

    private Double aggregate(Measure measure, List<List<String>> groupRows,
            Map<String, Integer> index) {
        if (measure.aggregation() == Aggregation.count) {
            if (measure.column() == null) {
                return (double) groupRows.size();
            }
            int col = index.get(measure.column());
            long count = groupRows.stream()
                .filter(row -> !cell(row, col).trim().isEmpty())
                .count();
            return (double) count;
        }
        int col = index.get(measure.column());
        List<BigDecimal> values = new ArrayList<>();
        for (List<String> row : groupRows) {
            String raw = cell(row, col).trim();
            if (raw.isEmpty()) {
                continue;
            }
            try {
                values.add(new BigDecimal(raw));
            } catch (NumberFormatException e) {
                // defensive: inference guarantees numeric, skip strays
            }
        }
        if (values.isEmpty()) {
            return null;
        }
        double result = switch (measure.aggregation()) {
            case sum -> total(values).doubleValue();
            case avg -> total(values)
                .divide(BigDecimal.valueOf(values.size()), MathContext.DECIMAL64).doubleValue();
            case min -> values.stream().min(BigDecimal::compareTo).orElseThrow().doubleValue();
            case max -> values.stream().max(BigDecimal::compareTo).orElseThrow().doubleValue();
            default -> throw new IllegalStateException("unexpected aggregation");
        };
        return finiteOrNull(result);
    }

    /**
     * Non-finite doubles (a magnitude past {@code Double.MAX_VALUE}, or NaN) would serialize as the
     * JSON string {@code "Infinity"} inside the declared {@code number[]} data array. {@code null}
     * already means "no usable value" in this response shape, so coerce to it.
     */
    private static Double finiteOrNull(double value) {
        return Double.isFinite(value) ? value : null;
    }

    private static BigDecimal total(List<BigDecimal> values) {
        return values.stream().reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    static String seriesLabel(Measure measure) {
        if (measure.label() != null && !measure.label().isBlank()) {
            return measure.label();
        }
        if (measure.column() == null) {
            return "count";
        }
        if (measure.aggregation() == Aggregation.none) {
            return measure.column();
        }
        return measure.aggregation() + "(" + measure.column() + ")";
    }

    static String cell(List<String> row, int index) {
        return index < row.size() ? row.get(index) : "";
    }

    private RenderResponse renderPoints(ChartSpec spec, List<List<String>> rows,
            Map<String, Integer> index) {
        int xIndex = index.get(spec.measures().get(0).column());
        int yIndex = index.get(spec.measures().get(1).column());
        Integer rIndex = spec.chartType() == ChartType.bubble
            ? index.get(spec.measures().get(2).column()) : null;
        int dimIndex = index.get(spec.dimension().column());
        int cap = spec.limit() != null ? spec.limit() : MAX_POINTS;

        if (spec.breakdown() == null) {
            List<String> labels = new ArrayList<>();
            List<Object> data = new ArrayList<>();
            for (List<String> row : rows) {
                Object point = point(row, xIndex, yIndex, rIndex);
                if (point == null) {
                    continue;
                }
                data.add(point);
                labels.add(cell(row, dimIndex).trim());
                if (data.size() >= cap) {
                    break;
                }
            }
            Series series = new Series(seriesLabel(spec.measures().get(1)), data);
            return response(spec, labels, List.of(series));
        }

        int breakdownIndex = index.get(spec.breakdown().column());
        SortedMap<String, List<Object>> bySeries = new TreeMap<>();
        for (List<String> row : rows) {
            Object point = point(row, xIndex, yIndex, rIndex);
            if (point == null) {
                continue;
            }
            String seriesKey = cell(row, breakdownIndex).trim();
            if (seriesKey.isEmpty()) {
                continue;
            }
            List<Object> data = bySeries.computeIfAbsent(seriesKey, k -> new ArrayList<>());
            if (data.size() < cap) {
                data.add(point);
            }
        }
        List<Series> datasets = new ArrayList<>();
        for (Map.Entry<String, List<Object>> entry : bySeries.entrySet()) {
            datasets.add(new Series(entry.getKey(), entry.getValue()));
        }
        return response(spec, List.of(), datasets);
    }

    private Object point(List<String> row, int xIndex, int yIndex, Integer rIndex) {
        Double x = parseDouble(cell(row, xIndex).trim());
        Double y = parseDouble(cell(row, yIndex).trim());
        if (x == null || y == null) {
            return null;
        }
        if (rIndex == null) {
            return new Point(x, y);
        }
        Double r = parseDouble(cell(row, rIndex).trim());
        if (r == null) {
            return null;
        }
        return new BubblePoint(x, y, r);
    }

    private static Double parseDouble(String raw) {
        if (raw.isEmpty()) {
            return null;
        }
        try {
            return finiteOrNull(new BigDecimal(raw).doubleValue());
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
