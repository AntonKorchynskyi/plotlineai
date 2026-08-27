package com.plotlineai.backend.dataset;

import java.time.Instant;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface DatasetRepository extends JpaRepository<Dataset, UUID> {

    @Modifying(clearAutomatically = true)
    @Query("delete from Dataset d where d.expiresAt < :cutoff")
    int deleteExpired(@Param("cutoff") Instant cutoff);
}
