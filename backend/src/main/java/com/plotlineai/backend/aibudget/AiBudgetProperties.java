package com.plotlineai.backend.aibudget;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "plotlineai.ai")
public record AiBudgetProperties(int dailyCallLimit) {
}
