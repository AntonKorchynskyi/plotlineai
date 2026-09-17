package com.plotlineai.backend.share;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ShareRepository extends JpaRepository<Share, UUID> {
}
