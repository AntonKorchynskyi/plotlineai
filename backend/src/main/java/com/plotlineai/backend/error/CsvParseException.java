package com.plotlineai.backend.error;

/** An upload that cannot be read as a table. {@code reason} is a short fixed code for telemetry. */
public class CsvParseException extends RuntimeException {

    private final String reason;

    public CsvParseException(String reason, String message) {
        super(message);
        this.reason = reason;
    }

    public String reason() {
        return reason;
    }
}
