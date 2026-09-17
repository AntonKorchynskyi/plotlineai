package com.plotlineai.backend.share;

import com.plotlineai.backend.share.dto.CreateShareRequest;
import com.plotlineai.backend.share.dto.CreateShareResponse;
import com.plotlineai.backend.share.dto.ShareResponse;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/shares")
public class ShareController {

    private final ShareService service;

    public ShareController(ShareService service) {
        this.service = service;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public CreateShareResponse create(@Valid @RequestBody CreateShareRequest request) {
        return service.create(request.datasetId(), request.spec());
    }

    @GetMapping("/{id}")
    public ShareResponse get(@PathVariable UUID id) {
        return service.get(id);
    }
}
