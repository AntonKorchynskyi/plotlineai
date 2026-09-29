package com.plotlineai.backend.dataset;

import com.plotlineai.backend.dataset.dto.CreateUploadRequest;
import com.plotlineai.backend.dataset.dto.CreateUploadResponse;
import com.plotlineai.backend.dataset.dto.DatasetDetailResponse;
import com.plotlineai.backend.dataset.dto.FinalizeUploadRequest;
import com.plotlineai.backend.dataset.dto.UploadResponse;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/datasets")
public class DatasetController {

    private final DatasetService service;

    public DatasetController(DatasetService service) {
        this.service = service;
    }

    /** Step 1 of an upload: a presigned URL the browser PUTs the file to. */
    @PostMapping(path = "/uploads", consumes = MediaType.APPLICATION_JSON_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public CreateUploadResponse presign(@RequestBody CreateUploadRequest request) {
        return service.presign(request);
    }

    /** Step 3: parse the uploaded file into a dataset. */
    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public UploadResponse finalizeUpload(@RequestBody FinalizeUploadRequest request) {
        return service.finalizeUpload(request.uploadId());
    }

    @GetMapping("/{id}")
    public DatasetDetailResponse get(@PathVariable UUID id) {
        return service.get(id);
    }
}
