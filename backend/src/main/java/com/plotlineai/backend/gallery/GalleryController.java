package com.plotlineai.backend.gallery;

import com.plotlineai.backend.gallery.GalleryService.CsvDownload;
import com.plotlineai.backend.gallery.dto.GalleryExampleResponse;
import java.util.List;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/gallery")
public class GalleryController {

    private static final MediaType TEXT_CSV = MediaType.parseMediaType("text/csv");

    private final GalleryService service;

    public GalleryController(GalleryService service) {
        this.service = service;
    }

    @GetMapping
    public List<GalleryExampleResponse> list() {
        return service.list();
    }

    @GetMapping("/{slug}/csv")
    public ResponseEntity<byte[]> csv(@PathVariable String slug) {
        CsvDownload download = service.csv(slug);
        return ResponseEntity.ok()
            .contentType(TEXT_CSV)
            .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment()
                .filename(download.filename()).build().toString())
            .body(download.content());
    }
}
