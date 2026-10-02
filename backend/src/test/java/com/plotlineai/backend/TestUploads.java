package com.plotlineai.backend;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Map;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import tools.jackson.databind.ObjectMapper;

/**
 * The browser's three-step upload, for tests: presign, PUT the file to S3, finalize. S3Mock
 * ignores signatures, so the PUT goes through the SDK instead of the presigned URL; what the
 * URL signs is covered by UploadStorePresignTest.
 */
public final class TestUploads {

    private final MockMvc mvc;
    private final S3Client s3;
    private final ObjectMapper objectMapper;

    public TestUploads(MockMvc mvc, S3Client s3, ObjectMapper objectMapper) {
        this.mvc = mvc;
        this.s3 = s3;
        this.objectMapper = objectMapper;
    }

    public ResultActions presign(String filename, String contentType, long size) throws Exception {
        String body = objectMapper.writeValueAsString(
            Map.of("filename", filename, "contentType", contentType, "size", size));
        return mvc.perform(post("/datasets/uploads").contentType(MediaType.APPLICATION_JSON).content(body));
    }

    /** Puts the bytes where the presigned URL points, as the browser would. */
    public void put(UUID uploadId, byte[] bytes) {
        s3.putObject(b -> b.bucket(AwsTestcontainersConfiguration.DATA_BUCKET)
            .key("uploads/" + uploadId + ".csv").contentType("text/csv"), RequestBody.fromBytes(bytes));
    }

    public ResultActions finalizeUpload(UUID uploadId) throws Exception {
        return mvc.perform(post("/datasets").contentType(MediaType.APPLICATION_JSON)
            .content("{\"uploadId\":\"" + uploadId + "\"}"));
    }

    public UUID uploadId(ResultActions presigned) throws Exception {
        String body = presigned.andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        return UUID.fromString(objectMapper.readTree(body).get("uploadId").asString());
    }

    /** All three steps; returns the finalize response for the caller to assert on. */
    public ResultActions upload(String filename, byte[] bytes) throws Exception {
        UUID uploadId = uploadId(presign(filename, "text/csv", bytes.length));
        put(uploadId, bytes);
        return finalizeUpload(uploadId);
    }

    /** Uploads and returns the new dataset's id. */
    public UUID datasetId(String filename, byte[] bytes) throws Exception {
        String body = upload(filename, bytes).andExpect(status().isCreated())
            .andReturn().getResponse().getContentAsString();
        return UUID.fromString(objectMapper.readTree(body).get("datasetId").asString());
    }
}
