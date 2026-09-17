package com.plotlineai.backend.share;

import com.plotlineai.backend.chart.ChartService;
import com.plotlineai.backend.chart.dto.RenderResponse;
import com.plotlineai.backend.chart.spec.ChartSpec;
import com.plotlineai.backend.error.ShareNotFoundException;
import com.plotlineai.backend.share.dto.CreateShareResponse;
import com.plotlineai.backend.share.dto.ShareResponse;
import java.time.Instant;
import java.util.UUID;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

@Service
public class ShareService {

    private final ShareRepository repository;
    private final ChartService chartService;
    private final ObjectMapper objectMapper;

    public ShareService(ShareRepository repository, ChartService chartService,
            ObjectMapper objectMapper) {
        this.repository = repository;
        this.chartService = chartService;
        this.objectMapper = objectMapper;
    }

    /**
     * Renders the snapshot server-side, so nothing client-supplied is persisted and the share
     * keeps working after the dataset hits its TTL. Deliberately untransactional: the render
     * releases its connection before the engine runs, and only the insert needs one.
     */
    public CreateShareResponse create(UUID datasetId, ChartSpec spec) {
        RenderResponse rendered = chartService.render(datasetId, spec);

        Share share = new Share();
        share.setId(UUID.randomUUID());
        share.setCreatedAt(Instant.now());
        share.setSpec(objectMapper.valueToTree(spec));
        share.setRenderedData(objectMapper.valueToTree(rendered));
        repository.save(share);

        return new CreateShareResponse(share.getId());
    }

    public ShareResponse get(UUID shareId) {
        Share share = repository.findById(shareId).orElseThrow(ShareNotFoundException::new);
        return new ShareResponse(share.getId(), share.getCreatedAt(), share.getRenderedData());
    }
}
