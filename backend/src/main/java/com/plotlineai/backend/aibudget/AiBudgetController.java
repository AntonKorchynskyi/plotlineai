package com.plotlineai.backend.aibudget;

import com.plotlineai.backend.aibudget.dto.ConsumeResponse;
import java.time.LocalDate;
import java.time.ZoneOffset;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Server to server only: web calls this before every provider call. The browser cannot reach
 * it, because web's /api/backend allowlist (frontend/lib/security/backend-paths.ts) never
 * forwards /internal paths.
 */
@RestController
public class AiBudgetController {

    private final AiBudgetService service;

    public AiBudgetController(AiBudgetService service) {
        this.service = service;
    }

    @PostMapping("/internal/ai-budget/consume")
    public ConsumeResponse consume() {
        return new ConsumeResponse(service.consume(LocalDate.now(ZoneOffset.UTC)));
    }
}
