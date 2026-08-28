package com.plotlineai.backend.chart.spec;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import tools.jackson.databind.JsonNode;

public record Filter(@NotBlank String column, @NotNull FilterOp op,
        @NotNull JsonNode value) {
}
