package com.plotlineai.backend.dataset;

import static org.junit.jupiter.api.Assertions.*;

import com.plotlineai.backend.TestcontainersConfiguration;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class DatasetTtlSweeperIT {

    @Autowired DatasetRepository repository;
    @Autowired DatasetTtlSweeper sweeper;
    @Autowired ObjectMapper objectMapper;

    private Dataset dataset(Instant expiresAt) throws Exception {
        var d = new Dataset();
        d.setId(UUID.randomUUID());
        d.setCreatedAt(Instant.now());
        d.setRowCount(1);
        d.setSchema(objectMapper.readTree("[]"));
        d.setRows(objectMapper.readTree("[[\"x\"]]"));
        d.setExpiresAt(expiresAt);
        return d;
    }

    @Test
    void deletesExpiredKeepsLive() throws Exception {
        var expired = repository.saveAndFlush(dataset(Instant.now().minusSeconds(60)));
        var live = repository.saveAndFlush(dataset(Instant.now().plusSeconds(3600)));

        sweeper.sweep();

        assertTrue(repository.findById(expired.getId()).isEmpty(), "expired should be deleted");
        assertTrue(repository.findById(live.getId()).isPresent(), "live should remain");
    }
}
