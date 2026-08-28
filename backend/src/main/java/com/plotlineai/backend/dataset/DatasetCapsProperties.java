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
        int sampleRows) {
}
