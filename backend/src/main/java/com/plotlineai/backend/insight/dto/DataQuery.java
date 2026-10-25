package com.plotlineai.backend.insight.dto;

import com.plotlineai.backend.chart.spec.Breakdown;
import com.plotlineai.backend.chart.spec.Dimension;
import com.plotlineai.backend.chart.spec.Filter;
import com.plotlineai.backend.chart.spec.Measure;
import com.plotlineai.backend.chart.spec.Sort;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * A question the insights AI asks of the whole dataset: a chart spec's building blocks, except
 * that the dimension is optional. Without one, each measure is computed over every row.
 *
 * @param limit how many groups to return, 50 when absent; {@code totalGroups} in the answer says
 *              how many there were
 */
public record DataQuery(
        @Valid Dimension dimension,
        @NotNull @Size(min = 1, max = 4) List<@NotNull @Valid Measure> measures,
        @Valid Breakdown breakdown,
        @Size(max = 5) List<@NotNull @Valid Filter> filters,
        @Valid Sort sort,
        @Min(1) @Max(100) Integer limit) {
}
