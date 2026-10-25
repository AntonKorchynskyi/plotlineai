package com.plotlineai.backend.insight.dto;

import java.util.List;

/** The insights web wrote for a dataset, as stored and as read back. */
public record InsightsBody(List<String> insights) {
}
