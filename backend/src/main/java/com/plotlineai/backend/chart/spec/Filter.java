package com.plotlineai.backend.chart.spec;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import tools.jackson.databind.JsonNode;

public record Filter(@NotBlank String column, @NotNull FilterOp op,
        @NotNull JsonNode value) {

    public Filter {
        // Jackson reads a JSON null into a JsonNode field as a NullNode, not a Java null, which
        // would slip past @NotNull. Normalize it so the constraint means what it says.
        if (value != null && value.isNull()) {
            value = null;
        }
    }
}
