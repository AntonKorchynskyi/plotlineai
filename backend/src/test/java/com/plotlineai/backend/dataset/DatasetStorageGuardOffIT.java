package com.plotlineai.backend.dataset;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.plotlineai.backend.TestcontainersConfiguration;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;

/** A cap that is not positive turns the guard off, rather than refusing every upload. */
@SpringBootTest(properties = "plotlineai.dataset.max-total-bytes=-1")
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class DatasetStorageGuardOffIT {

    @Autowired MockMvc mvc;
    @MockitoSpyBean DatasetRepository repository;

    @Test
    void acceptsUploadsWithoutMeasuringStorage() throws Exception {
        var csv = new MockMultipartFile("file", "data.csv", "text/csv",
            "region,revenue\nnorth,10\n".getBytes(StandardCharsets.UTF_8));

        mvc.perform(multipart("/datasets").file(csv)).andExpect(status().isCreated());
        mvc.perform(multipart("/datasets").file(csv)).andExpect(status().isCreated());

        verify(repository, never()).liveStorageBytes(any());
    }
}
