package com.plotlineai.backend.chart;

import com.plotlineai.backend.chart.dto.RenderRequest;
import com.plotlineai.backend.chart.dto.RenderResponse;
import com.plotlineai.backend.events.EventPublisher;
import jakarta.validation.Valid;
import java.util.Map;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/charts")
public class ChartController {

    private final ChartService service;
    private final EventPublisher events;

    public ChartController(ChartService service, EventPublisher events) {
        this.service = service;
        this.events = events;
    }

    /** Publishes `chart.rendered` here rather than in the service, so a share is not also a render. */
    @PostMapping("/render")
    public RenderResponse render(@Valid @RequestBody RenderRequest request) {
        long start = System.nanoTime();
        RenderResponse rendered = service.render(request.datasetId(), request.spec());
        events.publish("chart.rendered", Map.of("chartType", rendered.chartType(),
            "groups", rendered.labels().size(), "seriesCount", rendered.datasets().size(),
            "ms", (System.nanoTime() - start) / 1_000_000));
        return rendered;
    }
}
