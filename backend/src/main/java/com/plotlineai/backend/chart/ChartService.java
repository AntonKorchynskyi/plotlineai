package com.plotlineai.backend.chart;

import com.plotlineai.backend.chart.dto.RenderResponse;
import com.plotlineai.backend.chart.spec.ChartSpec;
import com.plotlineai.backend.dataset.Dataset;
import com.plotlineai.backend.dataset.DatasetRepository;
import com.plotlineai.backend.dataset.dto.ColumnSchema;
import com.plotlineai.backend.error.DatasetNotFoundException;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Service
public class ChartService {

    private static final TypeReference<List<ColumnSchema>> SCHEMA_LIST =
        new TypeReference<>() {};

    private final DatasetRepository repository;
    private final ObjectMapper objectMapper;
    private final ChartSpecValidator validator = new ChartSpecValidator();
    private final AggregationEngine engine = new AggregationEngine();

    public ChartService(DatasetRepository repository, ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    @Transactional(readOnly = true)
    public RenderResponse render(UUID datasetId, ChartSpec spec) {
        Dataset dataset = repository.findById(datasetId)
            .orElseThrow(() -> new DatasetNotFoundException(datasetId));
        List<ColumnSchema> schema = objectMapper.treeToValue(dataset.getSchema(), SCHEMA_LIST);
        validator.validate(spec, schema);
        return engine.render(spec, schema, toRows(dataset.getRows()));
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
