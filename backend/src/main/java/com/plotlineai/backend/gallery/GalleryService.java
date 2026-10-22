package com.plotlineai.backend.gallery;

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
}
