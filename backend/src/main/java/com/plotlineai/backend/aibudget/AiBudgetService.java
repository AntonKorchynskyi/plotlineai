package com.plotlineai.backend.aibudget;

import java.time.LocalDate;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * The cost circuit breaker: a global ceiling on provider calls per UTC day. Unlike web's
 * per-IP rate limit, it cannot be dodged by spoofing a client address, and because the count
 * is a row rather than a variable, no restart resets it.
 */
@Service
public class AiBudgetService {

    private static final Logger log = LoggerFactory.getLogger(AiBudgetService.class);

    /**
     * One statement, so concurrent callers can never push the count past the limit: the
     * update only happens while there is room, and no returned row means there was none.
     */
    private static final String CONSUME = """
        insert into ai_daily_usage (day, calls) values (?, 1)
        on conflict (day) do update set calls = ai_daily_usage.calls + 1
        where ai_daily_usage.calls < ?
        returning calls""";

    private final JdbcTemplate jdbc;
    private final int limit;
    private final AtomicReference<LocalDate> lastReported = new AtomicReference<>();

    public AiBudgetService(JdbcTemplate jdbc, AiBudgetProperties properties) {
        this.jdbc = jdbc;
        this.limit = properties.dailyCallLimit();
    }

    /** Takes one call from the day's allowance; false when it is already spent. */
    public boolean consume(LocalDate day) {
        List<Integer> spent = jdbc.query(CONSUME, (rs, i) -> rs.getInt(1), day, limit);
        if (!spent.isEmpty()) return true;

        LocalDate previous = lastReported.getAndSet(day);
        if (!day.equals(previous)) {
            log.warn("{\"event\":\"ai_daily_limit_reached\",\"limit\":{},\"day\":\"{}\"}", limit, day);
        }
        return false;
    }
}
