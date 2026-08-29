package com.plotlineai.backend.chart;

import com.plotlineai.backend.chart.DatasetLoader.LoadedDataset;
import com.plotlineai.backend.chart.dto.RenderResponse;
import com.plotlineai.backend.chart.spec.ChartSpec;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class ChartService {

    private final DatasetLoader loader;
    private final ChartSpecValidator validator = new ChartSpecValidator();
    private final AggregationEngine engine = new AggregationEngine();

    public ChartService(DatasetLoader loader) {
        this.loader = loader;
    }

    public RenderResponse render(UUID datasetId, ChartSpec spec) {
        LoadedDataset dataset = loader.load(datasetId);
        validator.validate(spec, dataset.schema());
        return engine.render(spec, dataset.schema(), dataset.rows());
    }
}
