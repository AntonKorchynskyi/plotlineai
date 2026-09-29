package com.plotlineai.backend.dataset.dto;

/** What the browser says about the file it is about to upload. Checked in DatasetService. */
public record CreateUploadRequest(String filename, String contentType, Long size) {
}
