package com.plotlineai.backend.share.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

/** {@code insights} is empty for a share made before they existed, or before they were ready. */
public record ShareResponse(UUID shareId, Instant createdAt, JsonNode renderedData, List<String> insights) {
}
