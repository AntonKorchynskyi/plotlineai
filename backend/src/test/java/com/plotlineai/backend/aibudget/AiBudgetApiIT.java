package com.plotlineai.backend.aibudget;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.plotlineai.backend.AwsTestcontainersConfiguration;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;

@SpringBootTest(properties = "plotlineai.ai.daily-call-limit=2")
@AutoConfigureMockMvc
@Import(AwsTestcontainersConfiguration.class)
class AiBudgetApiIT {

    private static final String CONSUME = "/internal/ai-budget/consume";

    @Autowired MockMvc mvc;
    @Autowired DynamoDbClient dynamo;

    @BeforeEach
    void clearToday() {
        dynamo.deleteItem(b -> b.tableName(AwsTestcontainersConfiguration.APP_TABLE)
            .key(Map.of("pk", AttributeValue.fromS("QUOTA#ai#" + LocalDate.now(ZoneOffset.UTC)))));
    }

    @Test
    void answersAllowedUntilTodaysLimitIsSpent() throws Exception {
        mvc.perform(post(CONSUME)).andExpect(status().isOk()).andExpect(jsonPath("$.allowed").value(true));
        mvc.perform(post(CONSUME)).andExpect(status().isOk()).andExpect(jsonPath("$.allowed").value(true));
        mvc.perform(post(CONSUME)).andExpect(status().isOk()).andExpect(jsonPath("$.allowed").value(false));
    }

    @Test
    void onlyPostSpends() throws Exception {
        mvc.perform(get(CONSUME)).andExpect(status().isMethodNotAllowed());
    }
}
