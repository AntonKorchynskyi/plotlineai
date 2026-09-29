package com.plotlineai.backend.dataset;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.plotlineai.backend.AwsTestcontainersConfiguration;
import com.plotlineai.backend.TestUploads;
import com.plotlineai.backend.TestcontainersConfiguration;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest
@AutoConfigureMockMvc
@Import({TestcontainersConfiguration.class, AwsTestcontainersConfiguration.class})
class DatasetApiIT {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired S3Client s3;

    private TestUploads uploads;

    @BeforeEach
    void setUp() {
        uploads = new TestUploads(mvc, s3, objectMapper);
    }

    private byte[] fixture(String name) throws Exception {
        return Files.readAllBytes(Path.of("src/test/resources/testdata/" + name));
    }

    @Test
    void presignReturnsAnUploadUrlAndItsHeaders() throws Exception {
        uploads.presign("sample.csv", "text/csv", 120)
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.uploadId").isNotEmpty())
            .andExpect(jsonPath("$.url").isNotEmpty())
            .andExpect(jsonPath("$.headers['Content-Type']").value("text/csv"))
            .andExpect(jsonPath("$.headers['Content-Length']").value("120"))
            .andExpect(jsonPath("$.expiresInSeconds").value(300));
    }

    @Test
    void uploadReturnsSchemaAndId() throws Exception {
        uploads.upload("sample.csv", fixture("sample.csv"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.datasetId").isNotEmpty())
            .andExpect(jsonPath("$.rowCount").value(3))
            .andExpect(jsonPath("$.schema[0].name").value("name"))
            .andExpect(jsonPath("$.schema[0].type").value("STRING"))
            .andExpect(jsonPath("$.schema[1].name").value("age"))
            .andExpect(jsonPath("$.schema[1].type").value("INTEGER"))
            .andExpect(jsonPath("$.schema[2].type").value("BOOLEAN"))
            .andExpect(jsonPath("$.schema[3].type").value("DATE"))
            .andExpect(jsonPath("$.schema[3].format").value("yyyy-MM-dd"));
    }

    @Test
    void getReturnsSampleRows() throws Exception {
        UUID id = uploads.datasetId("sample.csv", fixture("sample.csv"));

        mvc.perform(get("/datasets/" + id))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.rowCount").value(3))
            .andExpect(jsonPath("$.sampleRows.length()").value(3))
            .andExpect(jsonPath("$.sampleRows[0].name").value("Alice"))
            .andExpect(jsonPath("$.sampleRows[0].age").value("34"));
    }

    @Test
    void getTruncatesSampleRowsToCap() throws Exception {
        StringBuilder csv = new StringBuilder("n\n");
        for (int i = 1; i <= 25; i++) {
            csv.append(i).append('\n');
        }
        UUID id = uploads.datasetId("nums.csv", csv.toString().getBytes());

        mvc.perform(get("/datasets/" + id))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.rowCount").value(25))
            .andExpect(jsonPath("$.sampleRows.length()").value(20));
    }

    @Test
    void wrongContentTypeIs415() throws Exception {
        uploads.presign("sample.csv", "application/json", 10)
            .andExpect(status().isUnsupportedMediaType())
            .andExpect(jsonPath("$.error").value("INVALID_FILE_TYPE"));
    }

    @Test
    void wrongExtensionIs415() throws Exception {
        uploads.presign("data.xlsx", "text/csv", 10)
            .andExpect(status().isUnsupportedMediaType())
            .andExpect(jsonPath("$.error").value("INVALID_FILE_TYPE"));
    }

    @Test
    void zeroSizeIs400() throws Exception {
        uploads.presign("sample.csv", "text/csv", 0)
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("INVALID_REQUEST"));
    }

    @Test
    void missingFieldsAre400() throws Exception {
        mvc.perform(post("/datasets/uploads").contentType(MediaType.APPLICATION_JSON)
                .content("{\"filename\":\"a.csv\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("INVALID_REQUEST"));
    }

    @Test
    void declaredSizeOverTheLimitIs413() throws Exception {
        uploads.presign("big.csv", "text/csv", 5_242_881)
            .andExpect(status().isPayloadTooLarge())
            .andExpect(jsonPath("$.error").value("FILE_TOO_LARGE"));
    }

    @Test
    void anObjectLargerThanTheLimitIs413OnFinalize() throws Exception {
        UUID uploadId = uploads.uploadId(uploads.presign("big.csv", "text/csv", 100));
        byte[] big = new byte[5_242_881];
        Arrays.fill(big, (byte) 'a');
        uploads.put(uploadId, big);

        uploads.finalizeUpload(uploadId)
            .andExpect(status().isPayloadTooLarge())
            .andExpect(jsonPath("$.error").value("FILE_TOO_LARGE"));
    }

    @Test
    void finalizingAnUnknownUploadIs400() throws Exception {
        uploads.finalizeUpload(UUID.randomUUID())
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("UPLOAD_NOT_FOUND"));
    }

    @Test
    void finalizingTheSameUploadTwiceIs400TheSecondTime() throws Exception {
        byte[] csv = fixture("sample.csv");
        UUID uploadId = uploads.uploadId(uploads.presign("sample.csv", "text/csv", csv.length));
        uploads.put(uploadId, csv);

        uploads.finalizeUpload(uploadId).andExpect(status().isCreated());
        uploads.finalizeUpload(uploadId)
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("UPLOAD_NOT_FOUND"));
    }

    @Test
    void finalizeDeletesTheUploadedObject() throws Exception {
        byte[] csv = fixture("sample.csv");
        UUID uploadId = uploads.uploadId(uploads.presign("sample.csv", "text/csv", csv.length));
        uploads.put(uploadId, csv);
        uploads.finalizeUpload(uploadId).andExpect(status().isCreated());

        assertThrows(NoSuchKeyException.class, () -> s3.headObject(b -> b
            .bucket(AwsTestcontainersConfiguration.DATA_BUCKET).key("uploads/" + uploadId + ".csv")));
    }

    @Test
    void finalizeWithoutAnUploadIdIs400() throws Exception {
        mvc.perform(post("/datasets").contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("INVALID_REQUEST"));
    }

    @Test
    void binaryContentIs422() throws Exception {
        uploads.upload("fake.csv", fixture("binary.csv"))
            .andExpect(status().isUnprocessableEntity())
            .andExpect(jsonPath("$.error").value("MALFORMED_CSV"));
    }

    @Test
    void tooManyColumnsIs422CapExceeded() throws Exception {
        String header = IntStream.rangeClosed(1, 300).mapToObj(i -> "c" + i)
            .collect(Collectors.joining(","));
        String content = header + "\n" + "1,".repeat(299) + "1\n";
        uploads.upload("wide.csv", content.getBytes())
            .andExpect(status().isUnprocessableEntity())
            .andExpect(jsonPath("$.error").value("CAP_EXCEEDED"));
    }

    @Test
    void unknownIdIs404() throws Exception {
        mvc.perform(get("/datasets/" + UUID.randomUUID()))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("NOT_FOUND"));
    }

    @Test
    void malformedIdIs404NotFound() throws Exception {
        mvc.perform(get("/datasets/not-a-uuid"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("NOT_FOUND"));
    }
}
