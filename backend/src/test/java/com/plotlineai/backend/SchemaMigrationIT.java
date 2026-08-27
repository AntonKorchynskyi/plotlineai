package com.plotlineai.backend;

import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashSet;
import java.util.List;
import java.util.Set;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class SchemaMigrationIT {

    @Autowired
    DataSource dataSource;

    @Test
    void flywayCreatesCoreTables() throws Exception {
        Set<String> tables = new HashSet<>();
        try (var conn = dataSource.getConnection();
             var rs = conn.getMetaData().getTables(null, "public", "%", new String[] {"TABLE"})) {
            while (rs.next()) {
                tables.add(rs.getString("TABLE_NAME").toLowerCase());
            }
        }
        assertTrue(
            tables.containsAll(List.of("dataset", "gallery_example", "share", "flyway_schema_history")),
            "expected core tables, found: " + tables);
    }
}
