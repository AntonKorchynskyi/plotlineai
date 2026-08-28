package com.plotlineai.backend.chart.spec;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record Measure(String column, @NotNull Aggregation aggregation,
        @Size(max = 120) String label) {
}
