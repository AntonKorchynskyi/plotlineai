package com.plotlineai.backend.gallery;

import com.plotlineai.backend.gallery.dto.GalleryExampleResponse;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/gallery")
public class GalleryController {

    private final GalleryService service;

    public GalleryController(GalleryService service) {
        this.service = service;
    }

    @GetMapping
    public List<GalleryExampleResponse> list() {
        return service.list();
    }
}
