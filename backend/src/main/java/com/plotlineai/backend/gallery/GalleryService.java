package com.plotlineai.backend.gallery;

import com.plotlineai.backend.error.GalleryExampleNotFoundException;
import com.plotlineai.backend.gallery.dto.GalleryExampleResponse;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class GalleryService {

    private final GalleryRenderer renderer;

    public GalleryService(GalleryRenderer renderer) {
        this.renderer = renderer;
    }

    public List<GalleryExampleResponse> list() {
        return renderer.examples();
    }

    /**
     * The filename comes from the catalog, never from the request path, so a slug can only
     * ever select one of the curated files. An unknown slug is a 404; an entry whose backing
     * file is missing from the classpath is a server-side configuration problem and propagates
     * as {@link IllegalStateException}, mapped to 500 by the catch-all handler.
     */
    public CsvDownload csv(String slug) {
        GalleryCatalog.Entry entry = renderer.find(slug).orElseThrow(GalleryExampleNotFoundException::new);
        return new CsvDownload(entry.csvFilename(), GalleryCatalog.readCsv(entry.csvFilename()));
    }

    public record CsvDownload(String filename, byte[] content) {
    }
}
