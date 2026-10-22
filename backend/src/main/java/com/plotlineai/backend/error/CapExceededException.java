package com.plotlineai.backend.error;

/** An upload past one of the size caps. {@code reason} is a short fixed code for telemetry. */
public class CapExceededException extends RuntimeException {

    private final String reason;

    public CapExceededException(String reason, String message) {
        super(message);
        this.reason = reason;
    }

    public String reason() {
        return reason;
    }
}
