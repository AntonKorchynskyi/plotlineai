package com.plotlineai.backend.insight;

import com.plotlineai.backend.insight.dto.DataQuery;
import com.plotlineai.backend.insight.dto.InsightsBody;
import com.plotlineai.backend.insight.dto.QueryResult;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Server to server only: web's insights route calls these, the query once per AI tool call.
 * The browser cannot reach them, because web's /api/backend allowlist
 * (frontend/lib/security/backend-paths.ts) never forwards /internal paths, so nothing a
 * browser sends is stored as an insight.
 */
@RestController
@RequestMapping("/internal/datasets/{id}")
public class InsightController {

    private final InsightService service;
    private final DataQueryService queries;

    public InsightController(InsightService service, DataQueryService queries) {
        this.service = service;
        this.queries = queries;
    }

    /** The AI's tool: one aggregate question over every row. */
    @PostMapping("/query")
    public QueryResult query(@PathVariable UUID id, @Valid @RequestBody DataQuery query) {
        return queries.run(id, query);
    }

    @PutMapping("/insights")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void store(@PathVariable UUID id, @RequestBody InsightsBody body) {
        service.store(id, body.insights());
    }

    @GetMapping("/insights")
    public InsightsBody stored(@PathVariable UUID id) {
        return new InsightsBody(service.stored(id));
    }
}
