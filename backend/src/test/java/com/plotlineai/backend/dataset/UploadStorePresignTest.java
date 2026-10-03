package com.plotlineai.backend.dataset;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.plotlineai.backend.aws.AwsProperties;
import java.net.URI;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/**
 * S3Mock does not check signatures, so this pins what the URL signs: S3 itself then refuses a
 * PUT with any other length or type, or one made after five minutes.
 */
class UploadStorePresignTest {

    private final StaticCredentialsProvider credentials =
        StaticCredentialsProvider.create(AwsBasicCredentials.create("AKIDEXAMPLE", "secret"));

    private UploadStore store(String publicEndpoint) {
        var aws = new AwsProperties("us-east-1", null, null, publicEndpoint, "t", "plotlineai-data", null);
        var presigner = S3Presigner.builder().region(Region.US_EAST_1).credentialsProvider(credentials);
        if (publicEndpoint != null) {
            presigner.endpointOverride(URI.create(publicEndpoint))
                .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).build());
        }
        S3Client s3 = S3Client.builder().region(Region.US_EAST_1).credentialsProvider(credentials).build();
        return new UploadStore(s3, presigner.build(), aws);
    }

    @Test
    void signsLengthAndTypeForFiveMinutes() {
        UUID id = UUID.fromString("00000000-0000-0000-0000-000000000001");
        var presigned = store(null).presign(id, "text/csv", 1234);

        assertTrue(presigned.url().startsWith("https://plotlineai-data.s3.amazonaws.com/uploads/"
            + "00000000-0000-0000-0000-000000000001.csv?"), presigned.url());
        assertTrue(presigned.url().contains("X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost"),
            presigned.url());
        assertTrue(presigned.url().contains("X-Amz-Expires=300"), presigned.url());
        assertEquals(Map.of("Content-Type", "text/csv", "Content-Length", "1234"), presigned.headers());
    }

    @Test
    void locallyTheUrlGoesThroughThePublicEndpoint() {
        var presigned = store("http://localhost:3000/local-s3").presign(UUID.randomUUID(), "text/csv", 1);
        assertTrue(presigned.url().startsWith("http://localhost:3000/local-s3/plotlineai-data/uploads/"),
            presigned.url());
    }
}
