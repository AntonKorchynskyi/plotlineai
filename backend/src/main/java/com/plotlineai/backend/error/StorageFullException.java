package com.plotlineai.backend.error;

public class StorageFullException extends RuntimeException {
    public StorageFullException(String message) { super(message); }
}
