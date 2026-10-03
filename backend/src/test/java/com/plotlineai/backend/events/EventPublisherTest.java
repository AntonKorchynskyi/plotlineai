package com.plotlineai.backend.events;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.amazonaws.serverless.proxy.RequestReader;
import com.amazonaws.services.lambda.runtime.Context;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import software.amazon.awssdk.core.exception.SdkClientException;
import software.amazon.awssdk.services.eventbridge.EventBridgeClient;
import software.amazon.awssdk.services.eventbridge.model.PutEventsRequest;
import software.amazon.awssdk.services.eventbridge.model.PutEventsRequestEntry;
import software.amazon.awssdk.services.eventbridge.model.PutEventsResponse;
import software.amazon.awssdk.services.eventbridge.model.PutEventsResultEntry;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

class EventPublisherTest {

    private final ObjectMapper objectMapper = JsonMapper.builder().build();
    private final EventBridgeClient client = mock(EventBridgeClient.class);

    @AfterEach
    void clearRequest() {
        RequestContextHolder.resetRequestAttributes();
    }

    private PutEventsRequestEntry publishedEntry() {
        ArgumentCaptor<PutEventsRequest> request = ArgumentCaptor.forClass(PutEventsRequest.class);
        verify(client).putEvents(request.capture());
        assertEquals(1, request.getValue().entries().size());
        return request.getValue().entries().getFirst();
    }

    @Test
    void sendsOneEntryWithTheEnvelopeAndTheFields() {
        when(client.putEvents(any(PutEventsRequest.class))).thenReturn(PutEventsResponse.builder()
            .failedEntryCount(0).build());
        Instant before = Instant.now();

        new EventPublisher(client, "plotlineai", objectMapper)
            .publish("dataset.uploaded", Map.of("rowCount", 3, "bytes", 120L));

        PutEventsRequestEntry entry = publishedEntry();
        assertEquals("plotlineai", entry.eventBusName());
        assertEquals("plotlineai.api", entry.source());
        assertEquals("dataset.uploaded", entry.detailType());
        JsonNode detail = objectMapper.readTree(entry.detail());
        assertEquals(1, detail.get("version").asInt());
        assertFalse(Instant.parse(detail.get("occurredAt").asString()).isBefore(before));
        assertFalse(detail.get("requestId").asString().isBlank());
        assertEquals(3, detail.get("rowCount").asInt());
        assertEquals(120L, detail.get("bytes").asLong());
    }

    @Test
    void usesTheLambdaRequestIdWhenThereIsOne() {
        when(client.putEvents(any(PutEventsRequest.class))).thenReturn(PutEventsResponse.builder()
            .failedEntryCount(0).build());
        Context lambda = mock(Context.class);
        when(lambda.getAwsRequestId()).thenReturn("lambda-request-1");
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setAttribute(RequestReader.LAMBDA_CONTEXT_PROPERTY, lambda);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

        new EventPublisher(client, "plotlineai", objectMapper).publish("share.created", Map.of());

        JsonNode detail = objectMapper.readTree(publishedEntry().detail());
        assertEquals("lambda-request-1", detail.get("requestId").asString());
    }

    @Test
    void doesNothingWithoutABus() {
        new EventPublisher(client, "", objectMapper).publish("share.created", Map.of());

        verify(client, never()).putEvents(any(PutEventsRequest.class));
    }

    @Test
    void swallowsAnSdkFailure() {
        when(client.putEvents(any(PutEventsRequest.class))).thenThrow(SdkClientException.create("timed out"));

        assertDoesNotThrow(() -> new EventPublisher(client, "plotlineai", objectMapper)
            .publish("share.created", Map.of()));
    }

    @Test
    void swallowsARejectedEntry() {
        when(client.putEvents(any(PutEventsRequest.class))).thenReturn(PutEventsResponse.builder()
            .failedEntryCount(1)
            .entries(PutEventsResultEntry.builder().errorCode("InternalFailure").build())
            .build());

        assertDoesNotThrow(() -> new EventPublisher(client, "plotlineai", objectMapper)
            .publish("share.created", Map.of()));
    }
}
