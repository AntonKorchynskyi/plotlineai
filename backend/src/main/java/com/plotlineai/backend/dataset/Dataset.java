package com.plotlineai.backend.dataset;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import tools.jackson.databind.JsonNode;

@Entity
@Table(name = "dataset")
public class Dataset {

    @Id
    private UUID id;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "row_count", nullable = false)
    private int rowCount;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "schema", nullable = false)
    private JsonNode schema;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "\"rows\"", nullable = false)
    private JsonNode rows;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    public Dataset() {
    }

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public int getRowCount() { return rowCount; }
    public void setRowCount(int rowCount) { this.rowCount = rowCount; }
    public JsonNode getSchema() { return schema; }
    public void setSchema(JsonNode schema) { this.schema = schema; }
    public JsonNode getRows() { return rows; }
    public void setRows(JsonNode rows) { this.rows = rows; }
    public Instant getExpiresAt() { return expiresAt; }
    public void setExpiresAt(Instant expiresAt) { this.expiresAt = expiresAt; }
}
