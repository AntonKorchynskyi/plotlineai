package com.plotlineai.backend.dataset.dto;

import java.util.Map;
import java.util.UUID;

/** Where to PUT the file, the exact headers to send, and how long the URL stays valid. */
public record CreateUploadResponse(UUID uploadId, String url, Map<String, String> headers, long expiresInSeconds) {
}
