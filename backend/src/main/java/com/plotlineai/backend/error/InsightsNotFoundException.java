package com.plotlineai.backend.error;

public class InsightsNotFoundException extends NotFoundException {

    public InsightsNotFoundException() {
        super("No insights stored for this dataset");
    }
}
