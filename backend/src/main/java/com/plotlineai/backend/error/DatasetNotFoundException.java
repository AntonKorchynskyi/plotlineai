package com.plotlineai.backend.error;

import java.util.UUID;

public class DatasetNotFoundException extends RuntimeException {

    public DatasetNotFoundException(UUID id) {
        super("Dataset not found: " + id);
    }
}
