package com.plotlineai.backend.dataset;

import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class DatasetTtlSweeper {

    private static final Logger log = LoggerFactory.getLogger(DatasetTtlSweeper.class);

    private final DatasetRepository repository;

    public DatasetTtlSweeper(DatasetRepository repository) {
        this.repository = repository;
    }

    @Scheduled(fixedDelayString = "${plotlineai.dataset.sweep-delay:PT1H}")
    @Transactional
    public void sweep() {
        long deleted = repository.deleteByExpiresAtBefore(Instant.now());
        if (deleted > 0) {
            log.info("Deleted {} expired dataset(s)", deleted);
        }
    }
}
