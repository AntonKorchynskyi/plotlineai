package com.plotlineai.backend.dataset;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.plotlineai.backend.TestcontainersConfiguration;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;

/** A one-byte cap: the first upload fits into an empty store, and fills it. */
@SpringBootTest(properties = "plotlineai.dataset.max-total-bytes=1")
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class DatasetStorageGuardIT {

    @Autowired MockMvc mvc;

    private MockMultipartFile csv() {
        return new MockMultipartFile("file", "data.csv", "text/csv",
            "region,revenue\nnorth,10\n".getBytes(StandardCharsets.UTF_8));
    }

    @Test
    void refusesUploadsOnceLiveDatasetsReachTheCap() throws Exception {
        mvc.perform(multipart("/datasets").file(csv())).andExpect(status().isCreated());

        mvc.perform(multipart("/datasets").file(csv()))
            .andExpect(status().isServiceUnavailable())
            .andExpect(jsonPath("$.error").value("STORAGE_FULL"));
    }
}
