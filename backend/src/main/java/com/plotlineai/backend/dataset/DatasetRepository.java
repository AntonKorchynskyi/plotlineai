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

    /** What live datasets take on disk, as Postgres stores them (compressed, TOASTed). */
    @Query(value = """
        select coalesce(sum(pg_column_size(rows) + pg_column_size(schema)), 0)
        from dataset where expires_at > :now""", nativeQuery = true)
    long liveStorageBytes(@Param("now") Instant now);

    @Transactional
    @Modifying(clearAutomatically = true)
    @Query("delete from Dataset d where d.expiresAt < :cutoff")
    int deleteExpired(@Param("cutoff") Instant cutoff);
}
