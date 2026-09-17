package com.plotlineai.backend.gallery.dto;

import tools.jackson.databind.JsonNode;

public record GalleryExampleResponse(
        String slug,
        String title,
        String description,
        String chartType,
        JsonNode renderedData,
        String csvUrl) {
}
