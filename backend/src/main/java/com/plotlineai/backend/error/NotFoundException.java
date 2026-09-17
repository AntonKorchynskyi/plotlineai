package com.plotlineai.backend.error;

/** Base for anything the API maps to 404 NOT_FOUND. */
public class NotFoundException extends RuntimeException {

    public NotFoundException(String message) {
        super(message);
    }
}
