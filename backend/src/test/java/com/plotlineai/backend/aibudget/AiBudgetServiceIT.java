package com.plotlineai.backend.aibudget;

import static org.junit.jupiter.api.Assertions.*;

import com.plotlineai.backend.AwsTestcontainersConfiguration;
import com.plotlineai.backend.TestcontainersConfiguration;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

/** Each test spends from its own day, so the tests never share a counter. */
@SpringBootTest(properties = "plotlineai.ai.daily-call-limit=3")
@Import({TestcontainersConfiguration.class, AwsTestcontainersConfiguration.class})
class AiBudgetServiceIT {

    @Autowired AiBudgetService service;

    @Test
    void allowsCallsUpToTheLimitThenRefuses() {
        LocalDate day = LocalDate.of(2101, 1, 1);
        assertTrue(service.consume(day));
        assertTrue(service.consume(day));
        assertTrue(service.consume(day));
        assertFalse(service.consume(day));
        assertFalse(service.consume(day));
    }

    @Test
    void aNewDayStartsOver() {
        LocalDate day = LocalDate.of(2101, 2, 1);
        for (int i = 0; i < 3; i++) service.consume(day);
        assertFalse(service.consume(day));

        assertTrue(service.consume(day.plusDays(1)));
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
                    return service.consume(day);
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
