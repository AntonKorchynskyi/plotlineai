package com.plotlineai.backend.aibudget;

import com.plotlineai.backend.quota.DailyCounter;
import java.time.LocalDate;
import java.util.concurrent.atomic.AtomicReference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * The cost circuit breaker: a global ceiling on provider calls per UTC day. Unlike web's
 * per-IP rate limit, it cannot be dodged by spoofing a client address, and because the count
 * lives in DynamoDB rather than a variable, no restart or new instance resets it.
 */
@Service
public class AiBudgetService {

    private static final Logger log = LoggerFactory.getLogger(AiBudgetService.class);

    private final DailyCounter counter;
    private final int limit;
    private final AtomicReference<LocalDate> lastReported = new AtomicReference<>();

    public AiBudgetService(DailyCounter counter, AiBudgetProperties properties) {
        this.counter = counter;
        this.limit = properties.dailyCallLimit();
    }

    /** Takes one call from the day's allowance; false when it is already spent. */
    public boolean consume(LocalDate day) {
        if (counter.tryConsume("ai", day, limit)) return true;

        LocalDate previous = lastReported.getAndSet(day);
        if (!day.equals(previous)) {
            log.warn("{\"event\":\"ai_daily_limit_reached\",\"limit\":{},\"day\":\"{}\"}", limit, day);
        }
        return false;
    }
}
