package com.plotlineai.backend.aws;

import java.net.URI;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.util.StringUtils;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/**
 * The SDK clients, built once at startup. On Lambda that is before the SnapStart snapshot, and
 * the SDK re-establishes its connections after a restore.
 */
@Configuration
public class AwsClientsConfig {

    @Bean
    DynamoDbClient dynamoDbClient(AwsProperties aws) {
        var builder = DynamoDbClient.builder()
            .region(Region.of(aws.region()))
            .httpClient(UrlConnectionHttpClient.create());
        if (StringUtils.hasText(aws.dynamodbEndpoint())) {
            builder.endpointOverride(URI.create(aws.dynamodbEndpoint()));
        }
        return builder.build();
    }

    @Bean
    S3Client s3Client(AwsProperties aws) {
        var builder = S3Client.builder()
            .region(Region.of(aws.region()))
            .httpClient(UrlConnectionHttpClient.create());
        if (StringUtils.hasText(aws.s3Endpoint())) {
            builder.endpointOverride(URI.create(aws.s3Endpoint())).forcePathStyle(true);
        }
        return builder.build();
    }

    /** Signs the URLs the browser uploads to, so locally it targets the public address. */
    @Bean
    S3Presigner s3Presigner(AwsProperties aws) {
        var builder = S3Presigner.builder().region(Region.of(aws.region()));
        String endpoint = StringUtils.hasText(aws.s3PublicEndpoint())
            ? aws.s3PublicEndpoint() : aws.s3Endpoint();
        if (StringUtils.hasText(endpoint)) {
            builder.endpointOverride(URI.create(endpoint))
                .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).build());
        }
        return builder.build();
    }
}
