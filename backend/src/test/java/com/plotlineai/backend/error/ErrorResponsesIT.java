package com.plotlineai.backend.error;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.plotlineai.backend.TestcontainersConfiguration;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/**
 * Framework-level failures answer in the same generic ErrorResponse shape as the api's own,
 * never Spring's default body, and actuator is not served on the application port.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class ErrorResponsesIT {

    @Autowired MockMvc mvc;

    private static void generic(ResultActions result, String code) throws Exception {
        result
            .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.error").value(code))
            .andExpect(jsonPath("$.message").value("The request could not be processed"))
            .andExpect(jsonPath("$.trace").doesNotExist())
            .andExpect(jsonPath("$.exception").doesNotExist())
            .andExpect(content().string(Matchers.not(Matchers.containsString("springframework"))));
    }

    @Test
    void unknownPathIsAGeneric404() throws Exception {
        generic(mvc.perform(get("/no/such/path")).andExpect(status().isNotFound()), "NOT_FOUND");
    }

    @Test
    void wrongMethodIsAGeneric405() throws Exception {
        generic(mvc.perform(delete("/datasets")).andExpect(status().isMethodNotAllowed()),
            "INVALID_REQUEST");
    }

    @Test
    void wrongContentTypeIsAGeneric415() throws Exception {
        generic(mvc.perform(post("/charts/render").contentType(MediaType.TEXT_PLAIN).content("x"))
            .andExpect(status().isUnsupportedMediaType()), "INVALID_REQUEST");
    }

    @Test
    void actuatorIsNotOnTheApplicationPort() throws Exception {
        mvc.perform(get("/actuator/health")).andExpect(status().isNotFound());
        mvc.perform(get("/actuator/env")).andExpect(status().isNotFound());
    }
}
