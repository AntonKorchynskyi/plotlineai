package com.plotlineai.backend.error;

/** No uploaded file under that id: never uploaded, already finalized, or cleared out. */
public class UploadNotFoundException extends RuntimeException {

    public UploadNotFoundException() {
        super("The upload was not found or has expired");
    }
}
