package com.plotlineai.backend.gallery;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.hamcrest.Matchers;
import com.plotlineai.backend.AwsTestcontainersConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@Import(AwsTestcontainersConfiguration.class)
class GalleryApiIT {

    @Autowired MockMvc mvc;

    @Test
    void listsExamplesInDisplayOrderWithRenderedData() throws Exception {
        mvc.perform(get("/gallery"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$", Matchers.hasSize(6)))
            .andExpect(jsonPath("$[0].slug").value("revenue-by-region"))
            .andExpect(jsonPath("$[0].title").value("Revenue by region"))
            .andExpect(jsonPath("$[0].chartType").value("bar"))
            .andExpect(jsonPath("$[0].description").isNotEmpty())
            .andExpect(jsonPath("$[0].renderedData.labels[0]").value("North America"))
            .andExpect(jsonPath("$[0].renderedData.datasets[0].data[0]").value(366350.0))
            .andExpect(jsonPath("$[5].slug").value("city-size-vs-density"))
            .andExpect(jsonPath("$[5].chartType").value("bubble"));
    }

    @Test
    void listDoesNotExposeSpecOrInternalIds() throws Exception {
        mvc.perform(get("/gallery"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].spec").doesNotExist())
            .andExpect(jsonPath("$[0].id").doesNotExist())
            .andExpect(jsonPath("$[0].csvFilename").doesNotExist())
            .andExpect(jsonPath("$[0].csvPath").doesNotExist());
    }

    @Test
    void exampleCsvsAreNotServed() throws Exception {
        mvc.perform(get("/gallery/traffic-sources/csv"))
            .andExpect(status().isNotFound());
    }
}
