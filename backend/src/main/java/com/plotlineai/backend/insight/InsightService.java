package com.plotlineai.backend.insight;

import com.plotlineai.backend.dataset.DatasetStore;
import com.plotlineai.backend.error.DatasetNotFoundException;
import com.plotlineai.backend.error.InsightsNotFoundException;
import com.plotlineai.backend.error.InvalidRequestException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * The insights web's AI wrote for a dataset. They are stored next to the dataset, so they
 * expire with it; a share copies them (see ShareService).
 */
@Service
public class InsightService {

    static final int MAX_INSIGHTS = 10;
    static final int MAX_INSIGHT_LENGTH = 240;

    private final DatasetStore store;

    public InsightService(DatasetStore store) {
        this.store = store;
    }

    public void store(UUID datasetId, List<String> insights) {
        if (insights == null || insights.isEmpty() || insights.size() > MAX_INSIGHTS) {
            throw new InvalidRequestException("Between 1 and " + MAX_INSIGHTS + " insights are required");
        }
        for (String insight : insights) {
            if (insight == null || insight.isBlank() || insight.length() > MAX_INSIGHT_LENGTH) {
                throw new InvalidRequestException(
                    "Each insight must be non-blank and at most " + MAX_INSIGHT_LENGTH + " characters");
            }
        }
        requireLive(datasetId);
        store.writeInsights(datasetId, List.copyOf(insights));
    }

    public List<String> stored(UUID datasetId) {
        requireLive(datasetId);
        return store.readInsights(datasetId).orElseThrow(InsightsNotFoundException::new);
    }

    /** For a share: the insights if web has stored them by now, else none. */
    public List<String> storedOrNone(UUID datasetId) {
        return store.readInsights(datasetId).orElse(List.of());
    }

    private void requireLive(UUID datasetId) {
        store.findLive(datasetId, Instant.now()).orElseThrow(() -> new DatasetNotFoundException(datasetId));
    }
}
