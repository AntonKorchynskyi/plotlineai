package com.plotlineai.backend.dataset;

import java.time.Instant;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DatasetRepository extends JpaRepository<Dataset, UUID> {

    long deleteByExpiresAtBefore(Instant cutoff);
}
