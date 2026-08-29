package com.plotlineai.backend.chart;

import com.plotlineai.backend.chart.dto.RenderRequest;
import com.plotlineai.backend.chart.dto.RenderResponse;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/charts")
public class ChartController {

    private final ChartService service;

    public ChartController(ChartService service) {
        this.service = service;
    }

    @PostMapping("/render")
    public RenderResponse render(@Valid @RequestBody RenderRequest request) {
        return service.render(request.datasetId(), request.spec());
    }
}
