package com.plotlineai.backend.gallery;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.plotlineai.backend.TestcontainersConfiguration;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
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
            .andExpect(jsonPath("$[0].csvUrl").value("/gallery/revenue-by-region/csv"))
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
            .andExpect(jsonPath("$[0].csvFilename").doesNotExist());
    }

    @Test
    void downloadsCsvAsAnAttachment() throws Exception {
        mvc.perform(get("/gallery/traffic-sources/csv"))
            .andExpect(status().isOk())
            .andExpect(header().string("Content-Disposition",
                Matchers.allOf(Matchers.startsWith("attachment"),
                    Matchers.containsString("traffic-sources.csv"))))
            .andExpect(content().contentTypeCompatibleWith("text/csv"))
            .andExpect(content().string(Matchers.startsWith("source,sessions")))
            .andExpect(content().string(Matchers.containsString("Organic search,48200")));
    }

    @Test
    void unknownSlugIs404() throws Exception {
        mvc.perform(get("/gallery/no-such-example/csv"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("NOT_FOUND"));
    }

    @Test
    void traversalShapedSlugReachesControllerAndIs404() throws Exception {
        mvc.perform(get("/gallery/..application.yaml/csv"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("NOT_FOUND"))
            .andExpect(content().string(Matchers.not(Matchers.containsString("datasource"))));

        mvc.perform(get("/gallery/....etc/csv"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("NOT_FOUND"))
            .andExpect(content().string(Matchers.not(Matchers.containsString("datasource"))));
    }

    @Test
    void encodedSlashSlugReachesControllerAsLiteralSegmentAndIs404() throws Exception {
        // Under MockMvc (no real servlet-container connector in this IT), the literal "%2F" in
        // this URI template is re-encoded to "%252F" by the request builder, so the servlet
        // decodes it exactly once back to the literal characters "..%2F..%2Fapplication.yaml" -
        // a single path segment, not an actual "/". The request reaches GalleryController like
        // any other unknown slug and is rejected there, not by container-level encoded-slash
        // protection.
        mvc.perform(get("/gallery/..%2F..%2Fapplication.yaml/csv"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("NOT_FOUND"))
            .andExpect(content().string(Matchers.not(Matchers.containsString("datasource"))));
    }
}
