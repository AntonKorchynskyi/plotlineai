package com.plotlineai.backend.dataset;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.plotlineai.backend.TestcontainersConfiguration;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class DatasetApiIT {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper objectMapper;

    private MockMultipartFile csvFile(String name, byte[] content) {
        return new MockMultipartFile("file", name, "text/csv", content);
    }

    private byte[] fixture(String name) throws Exception {
        return Files.readAllBytes(Path.of("src/test/resources/testdata/" + name));
    }

    @Test
    void uploadReturnsSchemaAndId() throws Exception {
        mvc.perform(multipart("/datasets").file(csvFile("sample.csv", fixture("sample.csv"))))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.datasetId").isNotEmpty())
            .andExpect(jsonPath("$.rowCount").value(3))
            .andExpect(jsonPath("$.schema[0].name").value("name"))
            .andExpect(jsonPath("$.schema[0].type").value("STRING"))
            .andExpect(jsonPath("$.schema[1].name").value("age"))
            .andExpect(jsonPath("$.schema[1].type").value("INTEGER"))
            .andExpect(jsonPath("$.schema[2].type").value("BOOLEAN"))
            .andExpect(jsonPath("$.schema[3].type").value("DATE"));
    }

    @Test
    void getReturnsSampleRows() throws Exception {
        var result = mvc.perform(multipart("/datasets")
                .file(csvFile("sample.csv", fixture("sample.csv"))))
            .andExpect(status().isCreated())
            .andReturn();
        String id = objectMapper.readTree(result.getResponse().getContentAsString())
            .get("datasetId").asString();

        mvc.perform(get("/datasets/" + id))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.rowCount").value(3))
            .andExpect(jsonPath("$.sampleRows.length()").value(3))
            .andExpect(jsonPath("$.sampleRows[0].name").value("Alice"))
            .andExpect(jsonPath("$.sampleRows[0].age").value("34"));
    }

    @Test
    void wrongContentTypeIs415() throws Exception {
        var file = new MockMultipartFile("file", "sample.csv", "application/json",
            "a,b\n1,2\n".getBytes());
        mvc.perform(multipart("/datasets").file(file))
            .andExpect(status().isUnsupportedMediaType())
            .andExpect(jsonPath("$.error").value("INVALID_FILE_TYPE"));
    }

    @Test
    void wrongExtensionIs415() throws Exception {
        mvc.perform(multipart("/datasets").file(csvFile("data.xlsx", "a\n1\n".getBytes())))
            .andExpect(status().isUnsupportedMediaType())
            .andExpect(jsonPath("$.error").value("INVALID_FILE_TYPE"));
    }

    @Test
    void binaryContentIs422() throws Exception {
        mvc.perform(multipart("/datasets").file(csvFile("fake.csv", fixture("binary.csv"))))
            .andExpect(status().isUnprocessableEntity())
            .andExpect(jsonPath("$.error").value("MALFORMED_CSV"));
    }

    @Test
    void oversizedFileIs413() throws Exception {
        byte[] big = new byte[6 * 1024 * 1024];
        java.util.Arrays.fill(big, (byte) 'a');
        mvc.perform(multipart("/datasets").file(csvFile("big.csv", big)))
            .andExpect(status().isPayloadTooLarge())
            .andExpect(jsonPath("$.error").value("FILE_TOO_LARGE"));
    }

    @Test
    void unknownIdIs404() throws Exception {
        mvc.perform(get("/datasets/" + UUID.randomUUID()))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("NOT_FOUND"));
    }

    @Test
    void malformedIdIs400Or404WithJsonBody() throws Exception {
        mvc.perform(get("/datasets/not-a-uuid"))
            .andExpect(status().is4xxClientError())
            .andExpect(jsonPath("$.error").isNotEmpty());
    }
}
