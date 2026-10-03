package com.plotlineai.backend.quota;

import com.plotlineai.backend.events.EventPublisher;
import java.time.LocalDate;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * Publishes `quota.exhausted`, which EventBridge turns into an email to the owner, once per
 * quota and day across every api instance: each instance that sees a refusal tries to take the
 * day's single "alerted" slot, and only one ever gets it.
 */
@Component
public class QuotaAlert {

    private final DailyCounter counter;
    private final EventPublisher events;

    public QuotaAlert(DailyCounter counter, EventPublisher events) {
        this.counter = counter;
        this.events = events;
    }

    public void exhausted(String quota, LocalDate day, int limit) {
        if (counter.tryConsume(quota + "-alerted", day, 1)) {
            events.publish("quota.exhausted", Map.of("quota", quota, "limit", limit, "day", day.toString()));
        }
    }
}
