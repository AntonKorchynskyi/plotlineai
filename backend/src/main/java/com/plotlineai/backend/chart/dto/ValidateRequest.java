package com.plotlineai.backend.chart.dto;

import com.plotlineai.backend.chart.spec.ChartSpec;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;

/** Up to three specs to check against one dataset's schema: a suggestion set at most. */
public record ValidateRequest(
        @NotNull UUID datasetId,
        @NotNull @Size(min = 1, max = 3) List<@NotNull @Valid ChartSpec> specs) {
}
