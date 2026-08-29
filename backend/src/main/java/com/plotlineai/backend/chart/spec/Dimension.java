package com.plotlineai.backend.chart.spec;

import jakarta.validation.constraints.NotBlank;

public record Dimension(@NotBlank String column, TimeBucket bucket) {
}
