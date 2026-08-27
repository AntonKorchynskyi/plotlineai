package com.plotlineai.backend.error;

public class CapExceededException extends RuntimeException {
    public CapExceededException(String message) { super(message); }
}
