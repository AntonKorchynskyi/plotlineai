package com.plotlineai.backend.chart.dto;

import com.plotlineai.backend.chart.spec.ChartSpec;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record RenderRequest(@NotNull UUID datasetId, @NotNull @Valid ChartSpec spec) {
}
