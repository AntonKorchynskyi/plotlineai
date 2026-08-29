package com.plotlineai.backend.chart.spec;

import jakarta.validation.constraints.NotNull;

public record Sort(@NotNull SortBy by, @NotNull SortDirection direction) {
}
