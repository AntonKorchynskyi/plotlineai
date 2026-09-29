package com.plotlineai.backend.error;

/** A request missing a required field, or carrying an impossible value. */
public class InvalidRequestException extends RuntimeException {

    public InvalidRequestException(String message) {
        super(message);
    }
}
