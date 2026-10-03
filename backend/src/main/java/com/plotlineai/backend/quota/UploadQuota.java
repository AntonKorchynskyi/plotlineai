package com.plotlineai.backend.quota;

import com.plotlineai.backend.dataset.DatasetCapsProperties;
import java.time.LocalDate;
import java.util.concurrent.atomic.AtomicReference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * How many uploads the whole service accepts per UTC day. Uploaded files and parsed rows cost
 * S3 storage until their lifecycle rules clear them, so this bounds storage the way the
 * database size guard used to.
 */
@Component
public class UploadQuota {

    private static final Logger log = LoggerFactory.getLogger(UploadQuota.class);

    private final DailyCounter counter;
    private final QuotaAlert alert;
    private final int limit;
    private final AtomicReference<LocalDate> lastReported = new AtomicReference<>();

    public UploadQuota(DailyCounter counter, QuotaAlert alert, DatasetCapsProperties caps) {
        this.counter = counter;
        this.alert = alert;
        this.limit = caps.uploadDailyLimit();
    }

    /** Takes one upload from the day's allowance; false when it is already spent. */
    public boolean tryConsume(LocalDate day) {
        if (counter.tryConsume("upload", day, limit)) return true;

        LocalDate previous = lastReported.getAndSet(day);
        if (!day.equals(previous)) {
            log.warn("{\"event\":\"upload_daily_limit_reached\",\"limit\":{},\"day\":\"{}\"}", limit, day);
            alert.exhausted("upload", day, limit);
        }
        return false;
    }
}
