package com.plotlineai.backend.dataset;

import java.time.Instant;
import java.util.UUID;

/** A dataset's DynamoDB item. Its rows and schema live in S3 (see {@link DatasetStore}). */
public record DatasetRecord(
        UUID id,
        int rowCount,
        int columnCount,
        long bytes,
        Instant createdAt,
        Instant expiresAt) {
}
