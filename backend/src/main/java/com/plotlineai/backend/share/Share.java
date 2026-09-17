package com.plotlineai.backend.share;

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
@Table(name = "share")
public class Share {

    @Id
    private UUID id;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "spec", nullable = false)
    private JsonNode spec;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "rendered_data", nullable = false)
    private JsonNode renderedData;

    public Share() {
    }

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public JsonNode getSpec() { return spec; }
    public void setSpec(JsonNode spec) { this.spec = spec; }
    public JsonNode getRenderedData() { return renderedData; }
    public void setRenderedData(JsonNode renderedData) { this.renderedData = renderedData; }
}
