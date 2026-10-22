package com.plotlineai.backend.dataset;

import java.util.List;

/** A parsed upload, with how it was read: its delimiter and the encoding its bytes were in. */
public record ParsedCsv(List<String> headers, List<List<String>> rows, char delimiter, String encoding) {

    public ParsedCsv(List<String> headers, List<List<String>> rows) {
        this(headers, rows, ',', "UTF-8");
    }
}
