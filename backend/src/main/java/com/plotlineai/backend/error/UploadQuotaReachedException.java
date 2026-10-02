package com.plotlineai.backend.error;

/** The service-wide daily upload allowance is spent. */
public class UploadQuotaReachedException extends RuntimeException {

    public UploadQuotaReachedException() {
        super("Uploads are paused for today");
    }
}
