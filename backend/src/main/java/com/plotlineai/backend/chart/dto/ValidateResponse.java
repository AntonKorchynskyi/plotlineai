package com.plotlineai.backend.chart.dto;

import java.util.List;

/**
 * One result per spec, in order. {@code error} is null for a spec that draws a chart; otherwise it
 * is a fixed message (the validator's, the engine's, or "no data"), naming no column and no value.
 */
public record ValidateResponse(List<Result> results) {

    public record Result(String error) {
    }
}
