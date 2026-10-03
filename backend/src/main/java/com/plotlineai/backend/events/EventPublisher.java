package com.plotlineai.backend.events;

import com.amazonaws.serverless.proxy.RequestReader;
import com.amazonaws.services.lambda.runtime.Context;
import com.plotlineai.backend.aws.AwsProperties;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import software.amazon.awssdk.services.eventbridge.EventBridgeClient;
import software.amazon.awssdk.services.eventbridge.model.PutEventsRequest;
import software.amazon.awssdk.services.eventbridge.model.PutEventsRequestEntry;
import software.amazon.awssdk.services.eventbridge.model.PutEventsResponse;
import tools.jackson.databind.ObjectMapper;

/**
 * Sends the api's usage events to EventBridge (the contract is infra/events/schema.md). Events
 * carry counts and timings only: never an IP, a file name, a column name or a cell value.
 *
 * <p>Publishing blocks the request for at most a second, because a Lambda freezes as soon as it
 * has answered and a background send might never finish. A failure is logged and swallowed:
 * analytics must never cost a user their request.
 */
@Component
public class EventPublisher {

    static final String SOURCE = "plotlineai.api";
    static final int VERSION = 1;

    private static final Logger log = LoggerFactory.getLogger(EventPublisher.class);

    private final EventBridgeClient client;
    private final String bus;
    private final ObjectMapper objectMapper;

    @Autowired
    public EventPublisher(EventBridgeClient client, AwsProperties aws, ObjectMapper objectMapper) {
        this(client, aws.eventBus(), objectMapper);
    }

    EventPublisher(EventBridgeClient client, String bus, ObjectMapper objectMapper) {
        this.client = client;
        this.bus = bus;
        this.objectMapper = objectMapper;
    }

    /** Publishes one event; `fields` go into `detail` after the envelope. */
    public void publish(String detailType, Map<String, Object> fields) {
        if (!StringUtils.hasText(bus)) {
            log.debug("{\"event\":\"event_skipped\",\"detailType\":\"{}\"}", detailType);
            return;
        }
        try {
            Map<String, Object> detail = new LinkedHashMap<>();
            detail.put("version", VERSION);
            detail.put("occurredAt", Instant.now().toString());
            detail.put("requestId", requestId());
            detail.putAll(fields);
            String json = objectMapper.writeValueAsString(detail);

            PutEventsResponse response = client.putEvents(PutEventsRequest.builder()
                .entries(PutEventsRequestEntry.builder()
                    .eventBusName(bus).source(SOURCE).detailType(detailType).detail(json).build())
                .build());
            if (response.failedEntryCount() != null && response.failedEntryCount() > 0) {
                String code = response.entries().isEmpty() ? null : response.entries().getFirst().errorCode();
                log.warn("{\"event\":\"event_publish_failed\",\"detailType\":\"{}\",\"error\":\"{}\"}",
                    detailType, code);
            }
        } catch (RuntimeException e) {
            log.warn("{\"event\":\"event_publish_failed\",\"detailType\":\"{}\",\"error\":\"{}\"}",
                detailType, e.getClass().getSimpleName());
        }
    }

    /** The Lambda invocation's id, which ties an event to its log lines; a fresh id elsewhere. */
    private static String requestId() {
        RequestAttributes request = RequestContextHolder.getRequestAttributes();
        if (request != null
                && request.getAttribute(RequestReader.LAMBDA_CONTEXT_PROPERTY, RequestAttributes.SCOPE_REQUEST)
                    instanceof Context lambda) {
            return lambda.getAwsRequestId();
        }
        return UUID.randomUUID().toString();
    }
}
