package com.plotlineai.backend.quota;

import static org.junit.jupiter.api.Assertions.*;

import com.plotlineai.backend.AwsTestcontainersConfiguration;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;

/** Each test counts under its own day, so the tests never share a counter. */
@SpringBootTest
@Import(AwsTestcontainersConfiguration.class)
class DailyCounterIT {

    @Autowired DailyCounter counter;
    @Autowired DynamoDbClient dynamo;

    @Test
    void allowsUpToTheLimitThenRefuses() {
        LocalDate day = LocalDate.of(2101, 1, 1);
        assertTrue(counter.tryConsume("test", day, 3));
        assertTrue(counter.tryConsume("test", day, 3));
        assertTrue(counter.tryConsume("test", day, 3));
        assertFalse(counter.tryConsume("test", day, 3));
        assertFalse(counter.tryConsume("test", day, 3));
    }

    @Test
    void aNewDayStartsOver() {
        LocalDate day = LocalDate.of(2101, 2, 1);
        for (int i = 0; i < 3; i++) counter.tryConsume("test", day, 3);
        assertFalse(counter.tryConsume("test", day, 3));
        assertTrue(counter.tryConsume("test", day.plusDays(1), 3));
    }

    @Test
    void countersWithDifferentNamesAreIndependent() {
        LocalDate day = LocalDate.of(2101, 4, 1);
        assertTrue(counter.tryConsume("a", day, 1));
        assertFalse(counter.tryConsume("a", day, 1));
        assertTrue(counter.tryConsume("b", day, 1));
    }

    @Test
    void theItemExpiresTwoDaysAfterItsDay() {
        LocalDate day = LocalDate.of(2101, 5, 1);
        counter.tryConsume("test", day, 3);
        var item = dynamo.getItem(b -> b.tableName(AwsTestcontainersConfiguration.APP_TABLE)
            .key(Map.of("pk", AttributeValue.fromS("QUOTA#test#2101-05-01")))).item();
        assertEquals("1", item.get("calls").n());
        assertEquals(day.plusDays(2).atStartOfDay(ZoneOffset.UTC).toEpochSecond(),
            Long.parseLong(item.get("expiresAt").n()));
    }

    @Test
    void concurrentCallsNeverExceedTheLimit() throws Exception {
        LocalDate day = LocalDate.of(2101, 3, 1);
        int threads = 20;
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        try {
            List<Future<Boolean>> results = new ArrayList<>();
            for (int i = 0; i < threads; i++) {
                Callable<Boolean> call = () -> {
                    start.await();
                    return counter.tryConsume("test", day, 3);
                };
                results.add(pool.submit(call));
            }
            start.countDown();
            int allowed = 0;
            for (Future<Boolean> result : results) {
                if (result.get()) allowed++;
            }
            assertEquals(3, allowed);
        } finally {
            pool.shutdownNow();
        }
    }
}
