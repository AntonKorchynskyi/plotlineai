package com.plotlineai.backend.error;

public class GalleryExampleNotFoundException extends NotFoundException {

    public GalleryExampleNotFoundException() {
        super("Gallery example not found");
    }
}
