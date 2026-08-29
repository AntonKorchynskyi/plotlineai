package com.plotlineai.backend.chart.dto;

import java.util.List;

public record RenderResponse(
        String chartType,
        boolean stacked,
        String title,
        List<String> labels,
        List<Series> datasets) {

    public record Series(String label, List<Object> data) {
    }
}
