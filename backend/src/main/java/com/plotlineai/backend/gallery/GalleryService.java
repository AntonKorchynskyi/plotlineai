package com.plotlineai.backend.gallery;

import com.plotlineai.backend.error.GalleryExampleNotFoundException;
import com.plotlineai.backend.gallery.dto.GalleryExampleResponse;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class GalleryService {

    private final GalleryExampleRepository repository;

    public GalleryService(GalleryExampleRepository repository) {
        this.repository = repository;
    }

    public List<GalleryExampleResponse> list() {
        return repository.findAllByOrderByDisplayOrderAsc().stream()
            .map(e -> new GalleryExampleResponse(e.getSlug(), e.getTitle(), e.getDescription(),
                e.getChartType(), e.getRenderedData(), "/gallery/" + e.getSlug() + "/csv"))
            .toList();
    }

    /**
     * The filename comes from the stored row, never from the request path, so a slug can only
     * ever select one of the seeded files.
     */
    public CsvDownload csv(String slug) {
        GalleryExample example = repository.findBySlug(slug)
            .orElseThrow(GalleryExampleNotFoundException::new);
        String path = GalleryCatalog.CSV_CLASSPATH_DIR + example.getCsvFilename();
        try (InputStream in = getClass().getClassLoader().getResourceAsStream(path)) {
            if (in == null) {
                throw new GalleryExampleNotFoundException();
            }
            return new CsvDownload(example.getCsvFilename(), in.readAllBytes());
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    public record CsvDownload(String filename, byte[] content) {
    }
}
