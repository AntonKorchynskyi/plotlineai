package com.plotlineai.backend.share.dto;

import java.time.Instant;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

public record ShareResponse(UUID shareId, Instant createdAt, JsonNode renderedData) {
}
