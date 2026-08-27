package com.plotlineai.backend.dataset;

import static org.junit.jupiter.api.Assertions.*;

import com.plotlineai.backend.TestcontainersConfiguration;
import java.time.Instant;
import java.util.UUID;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class DatasetPersistenceIT {

    @Autowired DatasetRepository repository;
    @Autowired DataSource dataSource;
    @Autowired ObjectMapper objectMapper;

    @Test
    void roundTripsJsonbColumns() throws Exception {
        var d = new Dataset();
        d.setId(UUID.randomUUID());
        d.setCreatedAt(Instant.now());
        d.setRowCount(2);
        d.setSchema(objectMapper.readTree("[{\"name\":\"a\",\"type\":\"INTEGER\"}]"));
        d.setRows(objectMapper.readTree("[[\"1\",\"x\"],[\"2\",\"y\"]]"));
        d.setExpiresAt(Instant.now().plusSeconds(3600));
        repository.saveAndFlush(d);

        var loaded = repository.findById(d.getId()).orElseThrow();
        assertEquals(2, loaded.getRowCount());
        assertEquals("a", loaded.getSchema().get(0).get("name").asString());
        assertEquals("2", loaded.getRows().get(1).get(0).asString());
    }

    @Test
    void expiresAtIndexExists() throws Exception {
        try (var conn = dataSource.getConnection();
             var ps = conn.prepareStatement(
                 "select count(*) from pg_indexes where tablename = 'dataset' and indexname = 'idx_dataset_expires_at'");
             var rs = ps.executeQuery()) {
            rs.next();
            assertEquals(1, rs.getInt(1), "idx_dataset_expires_at must exist");
        }
    }

    @Test
    void capsPropertiesBindDefaults(@Autowired DatasetCapsProperties caps) {
        assertEquals(5 * 1024 * 1024L, caps.maxFileBytes());
        assertEquals(100_000, caps.maxRows());
        assertEquals(256, caps.maxColumns());
        assertEquals(32_768, caps.maxCellChars());
        assertEquals(java.time.Duration.ofDays(7), caps.ttl());
        assertEquals(20, caps.sampleRows());
    }
}
