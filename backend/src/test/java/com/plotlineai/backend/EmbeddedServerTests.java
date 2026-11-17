package com.plotlineai.backend;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.tomcat.TomcatWebServer;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.context.annotation.Import;

/**
 * Outside Lambda the api must serve over real Tomcat. spring-cloud-function-serverless-web (pulled
 * in by the Lambda container) ships an auto-configuration that replaces the web server with a no-op
 * one; if it ever wins again, the app starts, listens on nothing and the compose healthcheck fails.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "management.server.port=0")
@Import(AwsTestcontainersConfiguration.class)
class EmbeddedServerTests {

    @Autowired
    private WebServerApplicationContext context;

    @Test
    void servesOverTomcatWithTheHealthEndpointUp() throws Exception {
        assertThat(context.getWebServer()).isInstanceOf(TomcatWebServer.class);
        assertThat(context.getWebServer().getPort()).isPositive();

        int managementPort = Integer.parseInt(context.getEnvironment().getProperty("local.management.port"));
        try (HttpClient client = HttpClient.newHttpClient()) {
            HttpResponse<String> health = client.send(
                HttpRequest.newBuilder(URI.create("http://localhost:" + managementPort + "/actuator/health")).build(),
                HttpResponse.BodyHandlers.ofString());
            assertThat(health.statusCode()).isEqualTo(200);
            assertThat(health.body()).contains("\"UP\"");
        }
    }
}
