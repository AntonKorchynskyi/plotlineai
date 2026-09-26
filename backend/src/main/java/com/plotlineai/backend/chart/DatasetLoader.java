package com.plotlineai.backend.chart;

import com.plotlineai.backend.dataset.Dataset;
import com.plotlineai.backend.dataset.DatasetRepository;
import com.plotlineai.backend.dataset.dto.ColumnSchema;
import com.plotlineai.backend.error.DatasetNotFoundException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Loads a dataset and materializes its schema and rows inside a read-only transaction that
 * commits before the caller aggregates. Kept as a separate bean so the {@code @Transactional}
 * proxy boundary is real: {@link ChartService#render} is untransactional and invokes this
 * across the container proxy, so the connection is released before the in-memory engine pass.
 */
@Component
public class DatasetLoader {

    private static final TypeReference<List<ColumnSchema>> SCHEMA_LIST =
        new TypeReference<>() {};

    private final DatasetRepository repository;
    private final ObjectMapper objectMapper;

    public DatasetLoader(DatasetRepository repository, ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    public record LoadedDataset(List<ColumnSchema> schema, List<List<String>> rows) {
    }

    @Transactional(readOnly = true)
    public LoadedDataset load(UUID datasetId) {
        Dataset dataset = repository.findByIdAndExpiresAtAfter(datasetId, Instant.now())
            .orElseThrow(() -> new DatasetNotFoundException(datasetId));
        List<ColumnSchema> schema = objectMapper.treeToValue(dataset.getSchema(), SCHEMA_LIST);
        return new LoadedDataset(schema, toRows(dataset.getRows()));
    }

    private static List<List<String>> toRows(JsonNode rowsNode) {
        List<List<String>> rows = new ArrayList<>(rowsNode.size());
        for (JsonNode rowNode : rowsNode) {
            List<String> row = new ArrayList<>(rowNode.size());
            for (JsonNode cellNode : rowNode) {
                row.add(cellNode.asString());
            }
            rows.add(row);
        }
        return rows;
    }
}
