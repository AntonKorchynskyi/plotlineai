package com.plotlineai.backend;

import com.adobe.testing.s3mock.testcontainers.S3MockContainer;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.test.context.DynamicPropertyRegistrar;
import org.testcontainers.containers.GenericContainer;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;

/**
 * Local stand-ins for AWS: DynamoDB Local and S3Mock, the same images compose runs. The SDK's
 * default credential chain reads the dummy keys from system properties; neither emulator
 * checks them.
 */
@TestConfiguration(proxyBeanMethods = false)
public class AwsTestcontainersConfiguration {

    public static final String APP_TABLE = "plotlineai-app";
    public static final String DATA_BUCKET = "plotlineai-data";

    static {
        System.setProperty("aws.accessKeyId", "local");
        System.setProperty("aws.secretAccessKey", "local");
    }

    @Bean
    GenericContainer<?> dynamoDbLocal() {
        return new GenericContainer<>("amazon/dynamodb-local:3.3.1")
            .withCommand("-jar", "DynamoDBLocal.jar", "-inMemory", "-sharedDb")
            .withExposedPorts(8000);
    }

    @Bean
    S3MockContainer s3Mock() {
        return new S3MockContainer("5.2.3").withInitialBuckets(DATA_BUCKET);
    }

    @Bean
    DynamicPropertyRegistrar awsProperties(GenericContainer<?> dynamoDbLocal, S3MockContainer s3Mock) {
        return registry -> {
            registry.add("plotlineai.aws.dynamodb-endpoint",
                () -> "http://" + dynamoDbLocal.getHost() + ":" + dynamoDbLocal.getMappedPort(8000));
            registry.add("plotlineai.aws.s3-endpoint", s3Mock::getHttpEndpoint);
            registry.add("plotlineai.aws.app-table", () -> APP_TABLE);
            registry.add("plotlineai.aws.data-bucket", () -> DATA_BUCKET);
        };
    }

    @Bean
    ApplicationRunner createLocalTables(DynamoDbClient dynamo) {
        return args -> LocalTables.create(dynamo, APP_TABLE);
    }
}
