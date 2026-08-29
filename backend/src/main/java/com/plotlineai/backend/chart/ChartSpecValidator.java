package com.plotlineai.backend.chart;

import com.plotlineai.backend.chart.spec.Aggregation;
import com.plotlineai.backend.chart.spec.ChartSpec;
import com.plotlineai.backend.chart.spec.ChartType;
import com.plotlineai.backend.chart.spec.Filter;
import com.plotlineai.backend.chart.spec.FilterOp;
import com.plotlineai.backend.chart.spec.Measure;
import com.plotlineai.backend.dataset.ColumnType;
import com.plotlineai.backend.dataset.DateFormats;
import com.plotlineai.backend.dataset.dto.ColumnSchema;
import com.plotlineai.backend.error.InvalidChartSpecException;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import tools.jackson.databind.JsonNode;

public class ChartSpecValidator {

    private static final Set<ChartType> POINT_TYPES = EnumSet.of(ChartType.scatter, ChartType.bubble);
    private static final Set<ChartType> PIE_TYPES = EnumSet.of(ChartType.pie, ChartType.doughnut);
    private static final Set<ChartType> STACKABLE = EnumSet.of(ChartType.bar, ChartType.area);
    private static final Set<ColumnType> NUMERIC = EnumSet.of(ColumnType.INTEGER, ColumnType.DECIMAL);
    private static final Set<FilterOp> ORDERED_OPS =
        EnumSet.of(FilterOp.gt, FilterOp.gte, FilterOp.lt, FilterOp.lte);
    private static final int MAX_BREAKDOWN_CARDINALITY = 20;
    private static final int MAX_IN_VALUES = 50;

    public void validate(ChartSpec spec, List<ColumnSchema> schema) {
        Map<String, ColumnSchema> cols = new HashMap<>();
        for (ColumnSchema col : schema) {
            cols.putIfAbsent(col.name(), col);
        }

        ColumnSchema dim = require(cols, spec.dimension().column(), "dimension");
        if (spec.dimension().bucket() != null && dim.type() != ColumnType.DATE) {
            fail("A time bucket requires a DATE dimension column");
        }

        if (Boolean.TRUE.equals(spec.stacked()) && !STACKABLE.contains(spec.chartType())) {
            fail("stacked applies only to bar and area charts");
        }

        boolean pointType = POINT_TYPES.contains(spec.chartType());
        if (pointType) {
            validatePointMeasures(spec, cols);
            if (spec.dimension().bucket() != null) {
                fail("scatter and bubble charts do not support time buckets");
            }
            if (spec.sort() != null) {
                fail("scatter and bubble charts do not support sort");
            }
        } else {
            validateAggregatedMeasures(spec, cols);
        }

        if (PIE_TYPES.contains(spec.chartType())) {
            if (spec.measures().size() != 1) {
                fail("pie and doughnut charts take exactly one measure");
            }
            if (spec.breakdown() != null) {
                fail("pie and doughnut charts do not support a breakdown");
            }
        }

        if (spec.breakdown() != null) {
            ColumnSchema breakdown = require(cols, spec.breakdown().column(), "breakdown");
            if (breakdown.name().equals(spec.dimension().column())) {
                fail("The breakdown column must differ from the dimension column");
            }
            if (breakdown.cardinality() > MAX_BREAKDOWN_CARDINALITY) {
                fail("The breakdown column has too many distinct values (max "
                    + MAX_BREAKDOWN_CARDINALITY + ")");
            }
            if (!pointType && spec.measures().size() != 1) {
                fail("A breakdown requires exactly one measure");
            }
        }

        if (spec.filters() != null) {
            for (Filter filter : spec.filters()) {
                validateFilter(filter, cols);
            }
        }
    }

    private void validatePointMeasures(ChartSpec spec, Map<String, ColumnSchema> cols) {
        int expected = spec.chartType() == ChartType.bubble ? 3 : 2;
        if (spec.measures().size() != expected) {
            fail("This chart type takes exactly " + expected + " measures");
        }
        for (Measure measure : spec.measures()) {
            if (measure.aggregation() != Aggregation.none) {
                fail("scatter and bubble measures must use aggregation none");
            }
            if (measure.column() == null) {
                fail("scatter and bubble measures require a column");
            }
            ColumnSchema col = require(cols, measure.column(), "measure");
            if (!NUMERIC.contains(col.type())) {
                fail("scatter and bubble measures require numeric columns");
            }
        }
    }

    private void validateAggregatedMeasures(ChartSpec spec, Map<String, ColumnSchema> cols) {
        for (Measure measure : spec.measures()) {
            Aggregation agg = measure.aggregation();
            if (agg == Aggregation.none) {
                fail("aggregation none is only valid for scatter and bubble charts");
            }
            if (measure.column() == null) {
                if (agg != Aggregation.count) {
                    fail("A measure without a column must use aggregation count");
                }
                continue;
            }
            ColumnSchema col = require(cols, measure.column(), "measure");
            if (agg != Aggregation.count && !NUMERIC.contains(col.type())) {
                fail("This aggregation requires a numeric column");
            }
        }
    }

    private void validateFilter(Filter filter, Map<String, ColumnSchema> cols) {
        ColumnSchema col = require(cols, filter.column(), "filter");
        JsonNode value = filter.value();
        if (filter.op() == FilterOp.in) {
            if (!value.isArray() || value.isEmpty() || value.size() > MAX_IN_VALUES) {
                fail("An in filter requires an array of 1 to " + MAX_IN_VALUES + " strings");
            }
            for (JsonNode element : value) {
                if (!element.isString()) {
                    fail("An in filter requires an array of strings");
                }
            }
            return;
        }
        if (!value.isString() && !value.isNumber()) {
            fail("This filter requires a string or number value");
        }
        if (ORDERED_OPS.contains(filter.op())) {
            if (col.type() == ColumnType.DATE) {
                parseFilterDate(value.asString(), col.format());
            } else if (NUMERIC.contains(col.type())) {
                parseFilterNumber(value.asString());
            } else {
                fail("Ordered comparisons require a numeric or date column");
            }
        }
    }

    static LocalDate parseFilterDate(String value, String columnFormat) {
        try {
            return DateFormats.parseDate(value, columnFormat);
        } catch (DateTimeParseException e) {
            try {
                return LocalDate.parse(value);
            } catch (DateTimeParseException e2) {
                throw new InvalidChartSpecException("A date filter value could not be parsed");
            }
        }
    }

    static BigDecimal parseFilterNumber(String value) {
        try {
            return new BigDecimal(value);
        } catch (NumberFormatException e) {
            throw new InvalidChartSpecException("A numeric filter value could not be parsed");
        }
    }

    private static ColumnSchema require(Map<String, ColumnSchema> cols, String name, String role) {
        ColumnSchema col = cols.get(name);
        if (col == null) {
            throw new InvalidChartSpecException("The " + role + " references an unknown column");
        }
        return col;
    }

    private static void fail(String message) {
        throw new InvalidChartSpecException(message);
    }
}
