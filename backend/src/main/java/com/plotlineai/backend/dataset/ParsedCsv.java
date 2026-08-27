package com.plotlineai.backend.dataset;

import java.util.List;

public record ParsedCsv(List<String> headers, List<List<String>> rows) {
}
