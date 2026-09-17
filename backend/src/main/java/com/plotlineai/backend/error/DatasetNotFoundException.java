package com.plotlineai.backend.error;

import java.util.UUID;

public class DatasetNotFoundException extends NotFoundException {

    public DatasetNotFoundException(UUID id) {
        super("Dataset not found: " + id);
    }
}
