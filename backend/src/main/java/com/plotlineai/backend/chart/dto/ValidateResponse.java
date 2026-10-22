package com.plotlineai.backend.chart.dto;

import java.util.List;

/**
 * One result per spec, in order. {@code error} is null for a spec the renderer accepts;
 * otherwise it is the validator's or the engine's fixed message, naming no column and no value.
 * {@code empty} says an accepted spec draws nothing (its filters match no rows, or its columns
 * hold no values): a chart the user asked for may be meant that way, a suggestion never is.
 */
public record ValidateResponse(List<Result> results) {

    public record Result(String error, boolean empty) {
    }
}
