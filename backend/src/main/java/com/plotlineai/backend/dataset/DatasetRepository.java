package com.plotlineai.backend.dataset;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

public interface DatasetRepository extends JpaRepository<Dataset, UUID> {

    /** A dataset past its expiry is gone, whether or not a sweep has deleted it yet. */
    Optional<Dataset> findByIdAndExpiresAtAfter(UUID id, Instant now);

    @Transactional
    @Modifying(clearAutomatically = true)
    @Query("delete from Dataset d where d.expiresAt < :cutoff")
    int deleteExpired(@Param("cutoff") Instant cutoff);
}
