package com.plotlineai.backend.error;

public class ShareNotFoundException extends NotFoundException {

    public ShareNotFoundException() {
        super("Share not found");
    }
}
