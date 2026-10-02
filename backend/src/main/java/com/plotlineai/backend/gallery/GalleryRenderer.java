package com.plotlineai.backend.gallery;

import com.plotlineai.backend.chart.AggregationEngine;
import com.plotlineai.backend.chart.ChartSpecValidator;
import com.plotlineai.backend.dataset.CsvParser;
import com.plotlineai.backend.dataset.DatasetCapsProperties;
import com.plotlineai.backend.dataset.ParsedCsv;
import com.plotlineai.backend.dataset.SchemaInferrer;
import com.plotlineai.backend.dataset.dto.ColumnSchema;
import com.plotlineai.backend.gallery.dto.GalleryExampleResponse;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

/**
 * The landing-page examples, rendered once at startup through the real engine and kept in
 * memory. The catalog is code, so there is nothing to store: every instance renders the same
 * list, and on Lambda the render happens before the SnapStart snapshot. An entry whose spec
 * does not validate against its own CSV fails startup.
 */
@Component
public class GalleryRenderer {

    private final List<GalleryCatalog.Entry> entries;
    private final List<GalleryExampleResponse> examples;

    @Autowired
    public GalleryRenderer(DatasetCapsProperties caps, ObjectMapper objectMapper) {
        this(GalleryCatalog.ENTRIES, caps, objectMapper);
    }

    GalleryRenderer(List<GalleryCatalog.Entry> entries, DatasetCapsProperties caps, ObjectMapper objectMapper) {
        CsvParser csvParser = new CsvParser(caps);
        SchemaInferrer schemaInferrer = new SchemaInferrer();
        ChartSpecValidator validator = new ChartSpecValidator();
        AggregationEngine engine = new AggregationEngine();

        this.entries = List.copyOf(entries);
        this.examples = entries.stream()
            .sorted(Comparator.comparingInt(GalleryCatalog.Entry::displayOrder)
                .thenComparing(GalleryCatalog.Entry::slug))
            .map(entry -> {
                ParsedCsv parsed = csvParser.parse(GalleryCatalog.readCsv(entry.csvFilename()));
                List<ColumnSchema> schema = schemaInferrer.infer(parsed);
                validator.validate(entry.spec(), schema);
                return new GalleryExampleResponse(entry.slug(), entry.title(), entry.description(),
                    entry.spec().chartType().name(),
                    objectMapper.valueToTree(engine.render(entry.spec(), schema, parsed.rows())),
                    "/gallery/" + entry.slug() + "/csv");
            })
            .toList();
    }

    public List<GalleryExampleResponse> examples() {
        return examples;
    }

    public Optional<GalleryCatalog.Entry> find(String slug) {
        return entries.stream().filter(entry -> entry.slug().equals(slug)).findFirst();
    }
}
