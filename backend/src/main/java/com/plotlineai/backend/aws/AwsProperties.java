package com.plotlineai.backend.aws;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Where the api's AWS resources live. On AWS every endpoint is blank and the SDK uses the
 * region's real endpoints; compose and the tests point them at DynamoDB Local and S3Mock.
 *
 * @param s3PublicEndpoint the address presigned URLs are signed for, which the browser uses.
 *     Locally that is Caddy's /local-s3 route rather than S3Mock's container address.
 */
@ConfigurationProperties(prefix = "plotlineai.aws")
public record AwsProperties(
        String region,
        String dynamodbEndpoint,
        String s3Endpoint,
        String s3PublicEndpoint,
        String appTable,
        String dataBucket) {
}
