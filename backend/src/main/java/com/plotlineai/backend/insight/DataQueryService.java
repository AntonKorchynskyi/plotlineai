package com.plotlineai.backend.insight;

import com.plotlineai.backend.chart.AggregationEngine;
import com.plotlineai.backend.chart.ChartSpecValidator;
import com.plotlineai.backend.chart.DatasetLoader;
import com.plotlineai.backend.chart.dto.RenderResponse;
import com.plotlineai.backend.chart.spec.ChartSpec;
import com.plotlineai.backend.chart.spec.ChartType;
import com.plotlineai.backend.error.InvalidChartSpecException;
import com.plotlineai.backend.insight.dto.DataQuery;
import com.plotlineai.backend.insight.dto.QueryResult;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * Answers the insights AI's questions over every row, with the same validator and engine that
 * draw charts, so an insight's numbers match the chart of the same columns exactly.
 */
@Service
public class DataQueryService {

    static final int DEFAULT_LIMIT = 200;

    private final DatasetLoader loader;
    private final ChartSpecValidator validator = new ChartSpecValidator();
    private final AggregationEngine engine = new AggregationEngine();

    public DataQueryService(DatasetLoader loader) {
        this.loader = loader;
    }

    public QueryResult run(UUID datasetId, DataQuery query) {
        DatasetLoader.LoadedDataset dataset = loader.load(datasetId);
        RenderResponse answer;
        if (query.dimension() == null) {
            if (query.breakdown() != null || query.sort() != null) {
                throw new InvalidChartSpecException("breakdown and sort need a dimension");
            }
            validator.validateTotals(query.measures(), query.filters(), dataset.schema());
            answer = engine.totals(query.measures(), query.filters(), dataset.schema(), dataset.rows());
        } else {
            // No limit for the engine: it is applied below, once every group is counted.
            ChartSpec spec = new ChartSpec(ChartType.bar, null, "query", query.dimension(), query.measures(),
                query.breakdown(), query.filters(), query.sort(), null);
            validator.validate(spec, dataset.schema());
            answer = engine.render(spec, dataset.schema(), dataset.rows());
        }

        int limit = query.limit() == null ? DEFAULT_LIMIT : query.limit();
        int shown = Math.min(limit, answer.labels().size());
        List<RenderResponse.Series> series = answer.datasets().stream()
            .map(s -> new RenderResponse.Series(s.label(), s.data().subList(0, Math.min(shown, s.data().size()))))
            .toList();
        List<Double> totals = answer.datasets().stream().map(DataQueryService::total).toList();
        return new QueryResult(answer.labels().subList(0, shown), series, answer.labels().size(), totals);
    }

    /** The sum of a series' values over every group, before the limit. */
    private static Double total(RenderResponse.Series series) {
        double sum = 0;
        for (Object value : series.data()) {
            if (value instanceof Number number) sum += number.doubleValue();
        }
        return sum;
    }
}
