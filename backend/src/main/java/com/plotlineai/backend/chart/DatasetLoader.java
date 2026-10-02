package com.plotlineai.backend.chart;

import com.plotlineai.backend.dataset.DatasetStore;
import com.plotlineai.backend.dataset.dto.ColumnSchema;
import com.plotlineai.backend.error.DatasetNotFoundException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

/** Loads a live dataset's schema and every row, for the aggregation engine. */
@Component
public class DatasetLoader {

    private final DatasetStore store;

    public DatasetLoader(DatasetStore store) {
        this.store = store;
    }

    public record LoadedDataset(List<ColumnSchema> schema, List<List<String>> rows) {
    }

    public LoadedDataset load(UUID datasetId) {
        store.findLive(datasetId, Instant.now()).orElseThrow(() -> new DatasetNotFoundException(datasetId));
        return new LoadedDataset(store.readDetail(datasetId).schema(), store.readRows(datasetId));
    }
}
