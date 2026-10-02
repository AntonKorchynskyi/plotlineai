package com.plotlineai.backend.dataset;

import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.plotlineai.backend.AwsTestcontainersConfiguration;
import com.plotlineai.backend.TestUploads;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;
import software.amazon.awssdk.services.s3.S3Client;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(properties = "plotlineai.dataset.upload-daily-limit=2")
@AutoConfigureMockMvc
@Import(AwsTestcontainersConfiguration.class)
class UploadQuotaIT {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired S3Client s3;

    @Test
    void invalidRequestsDoNotSpendTheQuotaAndPresignsStopOnceItIsSpent() throws Exception {
        TestUploads uploads = new TestUploads(mvc, s3, objectMapper);
        uploads.presign("a.xlsx", "text/csv", 10).andExpect(status().isUnsupportedMediaType());
        uploads.presign("a.csv", "text/csv", 10).andExpect(status().isCreated());
        uploads.presign("b.csv", "text/csv", 10).andExpect(status().isCreated());

        uploads.presign("c.csv", "text/csv", 10)
            .andExpect(status().isServiceUnavailable())
            .andExpect(jsonPath("$.error").value("UPLOAD_QUOTA_REACHED"));
    }
}
