package com.plotlineai.backend.insight.dto;

import com.plotlineai.backend.chart.dto.RenderResponse.Series;
import java.util.List;

/**
 * The groups (at most the query's limit), how many groups the whole answer had, and per series
 * the sum of its values over every group, including those past the limit. For a sum or a count
 * that is the grand total each group is a share of; for avg, min or max it means nothing, and
 * web ignores it there.
 */
public record QueryResult(List<String> labels, List<Series> series, int totalGroups, List<Double> totals) {
}
