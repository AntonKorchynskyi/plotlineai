package com.plotlineai.backend.chart;

import com.plotlineai.backend.chart.DatasetLoader.LoadedDataset;
import com.plotlineai.backend.chart.dto.RenderResponse;
import com.plotlineai.backend.chart.dto.ValidateResponse;
import com.plotlineai.backend.chart.spec.ChartSpec;
import com.plotlineai.backend.error.InvalidChartSpecException;
import java.util.List;
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

    /**
     * Renders each spec without returning it: some limits (too many groups) and an empty result
     * show only against the rows. The dataset is loaded once for all the specs.
     */
    public ValidateResponse validate(UUID datasetId, List<ChartSpec> specs) {
        LoadedDataset dataset = loader.load(datasetId);
        return new ValidateResponse(specs.stream().map(spec -> {
            try {
                validator.validate(spec, dataset.schema());
                RenderResponse rendered = engine.render(spec, dataset.schema(), dataset.rows());
                boolean empty = rendered.datasets().stream().allMatch(s -> s.data().isEmpty());
                return new ValidateResponse.Result(null, empty);
            } catch (InvalidChartSpecException e) {
                return new ValidateResponse.Result(e.getMessage(), false);
            }
        }).toList());
    }
}
