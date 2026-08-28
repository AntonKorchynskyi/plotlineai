package com.plotlineai.backend.chart.spec;

import jakarta.validation.constraints.NotBlank;

public record Breakdown(@NotBlank String column) {
}
