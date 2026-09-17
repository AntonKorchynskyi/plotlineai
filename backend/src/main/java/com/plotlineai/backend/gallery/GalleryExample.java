package com.plotlineai.backend.gallery;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import tools.jackson.databind.JsonNode;

@Entity
@Table(name = "gallery_example")
public class GalleryExample {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "slug", nullable = false, unique = true)
    private String slug;

    @Column(name = "title", nullable = false)
    private String title;

    @Column(name = "description", nullable = false)
    private String description;

    @Column(name = "chart_type", nullable = false)
    private String chartType;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "spec", nullable = false)
    private JsonNode spec;

    @Column(name = "csv_filename", nullable = false)
    private String csvFilename;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "rendered_data", nullable = false)
    private JsonNode renderedData;

    @Column(name = "display_order", nullable = false)
    private int displayOrder;

    public GalleryExample() {
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getSlug() { return slug; }
    public void setSlug(String slug) { this.slug = slug; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
    public String getChartType() { return chartType; }
    public void setChartType(String chartType) { this.chartType = chartType; }
    public JsonNode getSpec() { return spec; }
    public void setSpec(JsonNode spec) { this.spec = spec; }
    public String getCsvFilename() { return csvFilename; }
    public void setCsvFilename(String csvFilename) { this.csvFilename = csvFilename; }
    public JsonNode getRenderedData() { return renderedData; }
    public void setRenderedData(JsonNode renderedData) { this.renderedData = renderedData; }
    public int getDisplayOrder() { return displayOrder; }
    public void setDisplayOrder(int displayOrder) { this.displayOrder = displayOrder; }
}
