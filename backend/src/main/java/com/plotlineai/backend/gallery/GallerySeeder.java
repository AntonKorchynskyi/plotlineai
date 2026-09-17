package com.plotlineai.backend.gallery;

import com.plotlineai.backend.chart.AggregationEngine;
import com.plotlineai.backend.chart.ChartSpecValidator;
import com.plotlineai.backend.chart.dto.RenderResponse;
import com.plotlineai.backend.dataset.CsvParser;
import com.plotlineai.backend.dataset.DatasetCapsProperties;
import com.plotlineai.backend.dataset.ParsedCsv;
import com.plotlineai.backend.dataset.SchemaInferrer;
import com.plotlineai.backend.dataset.dto.ColumnSchema;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

/**
 * Fills {@code gallery_example} at startup. The rendered snapshot has to come from the real
 * aggregation engine, which a .sql migration cannot run, so V2 only adds the ordering column
 * and the data is written here. Every boot converges on the catalog: entries are upserted by
 * slug, and any row whose slug is no longer in the catalog is deleted, so a renamed or removed
 * entry does not leave a stale card behind. A catalog entry whose spec does not validate
 * against its own CSV fails startup. Two {@code api} instances starting concurrently could
 * race on the unique slug constraint; single-instance compose makes this moot today.
 */
@Component
public class GallerySeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(GallerySeeder.class);

    private final GalleryExampleRepository repository;
    private final ObjectMapper objectMapper;
    private final TransactionTemplate transactionTemplate;
    private final CsvParser csvParser;
    private final SchemaInferrer schemaInferrer = new SchemaInferrer();
    private final ChartSpecValidator validator = new ChartSpecValidator();
    private final AggregationEngine engine = new AggregationEngine();

    public GallerySeeder(GalleryExampleRepository repository, ObjectMapper objectMapper,
            DatasetCapsProperties caps, PlatformTransactionManager transactionManager) {
        this.repository = repository;
        this.objectMapper = objectMapper;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
        this.csvParser = new CsvParser(caps);
    }

    @Override
    public void run(ApplicationArguments args) {
        seed();
    }

    public int seed() {
        List<Rendered> rendered = new ArrayList<>(GalleryCatalog.ENTRIES.size());
        for (GalleryCatalog.Entry entry : GalleryCatalog.ENTRIES) {
            ParsedCsv parsed = csvParser.parse(GalleryCatalog.readCsv(entry.csvFilename()));
            List<ColumnSchema> schema = schemaInferrer.infer(parsed);
            validator.validate(entry.spec(), schema);
            rendered.add(new Rendered(entry, engine.render(entry.spec(), schema, parsed.rows())));
        }

        List<String> slugs = GalleryCatalog.ENTRIES.stream().map(GalleryCatalog.Entry::slug).toList();
        transactionTemplate.executeWithoutResult(status -> {
            rendered.forEach(this::upsert);
            int pruned = repository.deleteBySlugNotIn(slugs);
            if (pruned > 0) {
                log.info("Pruned {} retired gallery examples", pruned);
            }
        });
        log.info("Seeded {} gallery examples", rendered.size());
        return rendered.size();
    }

    private void upsert(Rendered item) {
        GalleryCatalog.Entry entry = item.entry();
        GalleryExample row = repository.findBySlug(entry.slug()).orElseGet(GalleryExample::new);
        row.setSlug(entry.slug());
        row.setTitle(entry.title());
        row.setDescription(entry.description());
        row.setChartType(entry.spec().chartType().name());
        row.setSpec(objectMapper.valueToTree(entry.spec()));
        row.setCsvFilename(entry.csvFilename());
        row.setRenderedData(objectMapper.valueToTree(item.response()));
        row.setDisplayOrder(entry.displayOrder());
        repository.save(row);
    }

    private record Rendered(GalleryCatalog.Entry entry, RenderResponse response) {
    }
}
