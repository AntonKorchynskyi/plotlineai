package com.plotlineai.backend.dataset;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.plotlineai.backend.TestcontainersConfiguration;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.ObjectMapper;

/**
 * Expiry must hold without the scheduled sweeper: on Cloud Run an idle instance gets no CPU,
 * so a dataset past its TTL has to look gone to every read, and the next upload clears it out.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class DatasetExpiryIT {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired JdbcTemplate jdbc;
    @Autowired DatasetRepository repository;

    private UUID upload() throws Exception {
        var file = new MockMultipartFile("file", "data.csv", "text/csv",
            "region,revenue\nnorth,10\nsouth,20\n".getBytes(StandardCharsets.UTF_8));
        String body = mvc.perform(multipart("/datasets").file(file))
            .andExpect(status().isCreated())
            .andReturn().getResponse().getContentAsString();
        return UUID.fromString(objectMapper.readTree(body).get("datasetId").asString());
    }

    private void expire(UUID id) {
        jdbc.update("update dataset set expires_at = ? where id = ?",
            Timestamp.from(Instant.now().minusSeconds(60)), id);
    }

    private String renderBody(UUID id) {
        return """
            {"datasetId":"%s","spec":{"chartType":"bar","title":"Revenue",
             "dimension":{"column":"region"},"measures":[{"column":"revenue","aggregation":"sum"}]}}"""
            .formatted(id);
    }

    @Test
    void anExpiredDatasetIsNotFound() throws Exception {
        UUID id = upload();
        expire(id);

        mvc.perform(get("/datasets/" + id))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("NOT_FOUND"));
    }

    @Test
    void anExpiredDatasetCannotBeRendered() throws Exception {
        UUID id = upload();
        expire(id);

        mvc.perform(post("/charts/render").contentType(MediaType.APPLICATION_JSON).content(renderBody(id)))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("NOT_FOUND"));
    }

    @Test
    void aLiveDatasetIsStillServed() throws Exception {
        UUID id = upload();

        mvc.perform(get("/datasets/" + id)).andExpect(status().isOk());
        mvc.perform(post("/charts/render").contentType(MediaType.APPLICATION_JSON).content(renderBody(id)))
            .andExpect(status().isOk());
    }

    @Test
    void anUploadClearsOutExpiredDatasets() throws Exception {
        UUID old = upload();
        expire(old);

        upload();

        assertTrue(repository.findById(old).isEmpty(), "the expired dataset should be deleted");
    }
}
