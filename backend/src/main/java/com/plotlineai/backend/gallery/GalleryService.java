package com.plotlineai.backend.gallery;

import com.plotlineai.backend.error.GalleryExampleNotFoundException;
import com.plotlineai.backend.gallery.dto.GalleryExampleResponse;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class GalleryService {

    private final GalleryExampleRepository repository;

    public GalleryService(GalleryExampleRepository repository) {
        this.repository = repository;
    }

    public List<GalleryExampleResponse> list() {
        return repository.findAllByOrderByDisplayOrderAscSlugAsc().stream()
            .map(e -> new GalleryExampleResponse(e.getSlug(), e.getTitle(), e.getDescription(),
                e.getChartType(), e.getRenderedData(), "/gallery/" + e.getSlug() + "/csv"))
            .toList();
    }

    /**
     * The filename comes from the stored row, never from the request path, so a slug can only
     * ever select one of the seeded files. An unknown slug is a 404 from {@code findBySlug}; a
     * row whose backing file is missing from the classpath is a server-side configuration
     * problem and propagates as {@link IllegalStateException}, mapped to 500 by the catch-all
     * handler.
     */
    public CsvDownload csv(String slug) {
        GalleryExample example = repository.findBySlug(slug)
            .orElseThrow(GalleryExampleNotFoundException::new);
        return new CsvDownload(example.getCsvFilename(), GalleryCatalog.readCsv(example.getCsvFilename()));
    }

    public record CsvDownload(String filename, byte[] content) {
    }
}
