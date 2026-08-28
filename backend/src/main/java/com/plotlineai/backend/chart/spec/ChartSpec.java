package com.plotlineai.backend.chart.spec;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

public record ChartSpec(
        @NotNull ChartType chartType,
        Boolean stacked,
        @NotBlank @Size(max = 120) String title,
        @NotNull @Valid Dimension dimension,
        @NotNull @Size(min = 1, max = 4) @Valid List<Measure> measures,
        @Valid Breakdown breakdown,
        @Size(max = 5) @Valid List<Filter> filters,
        @Valid Sort sort,
        @Min(1) @Max(100) Integer limit) {
}
