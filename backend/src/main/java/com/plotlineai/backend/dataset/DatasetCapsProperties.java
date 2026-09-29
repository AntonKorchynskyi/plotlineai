package com.plotlineai.backend.dataset;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "plotlineai.dataset")
public record DatasetCapsProperties(
        long maxFileBytes,
        int maxRows,
        int maxColumns,
        int maxCellChars,
        Duration ttl,
        int sampleRows,
        /** Bytes live datasets may take in Postgres before uploads are refused; 0 or less is no cap. */
        long maxTotalBytes,
        /** Uploads the whole service accepts per UTC day. */
        int uploadDailyLimit) {
}
