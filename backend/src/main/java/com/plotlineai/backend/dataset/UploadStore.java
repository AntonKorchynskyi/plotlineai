package com.plotlineai.backend.dataset;

import com.plotlineai.backend.aws.AwsProperties;
import com.plotlineai.backend.error.FileTooLargeException;
import com.plotlineai.backend.error.UploadNotFoundException;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.core.ResponseInputStream;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/**
 * Raw CSV uploads, which the browser PUTs straight to S3 under {@code uploads/}. The bucket's
 * lifecycle rule deletes anything left there after a day, so an upload nobody finalizes costs
 * nothing for long.
 */
@Component
public class UploadStore {

    static final Duration URL_LIFETIME = Duration.ofSeconds(300);

    private final S3Client s3;
    private final S3Presigner presigner;
    private final String bucket;

    public UploadStore(S3Client s3, S3Presigner presigner, AwsProperties aws) {
        this.s3 = s3;
        this.presigner = presigner;
        this.bucket = aws.dataBucket();
    }

    /** Where the browser sends the file, and the headers it has to send with it. */
    public record PresignedUpload(String url, Map<String, String> headers) {
    }

    /**
     * Content-Type and Content-Length are part of the signature, so S3 refuses a PUT of any
     * other type or size: the declared size, already checked against the cap, is the size.
     */
    public PresignedUpload presign(UUID uploadId, String contentType, long size) {
        PutObjectRequest put = PutObjectRequest.builder()
            .bucket(bucket)
            .key(key(uploadId))
            .contentType(contentType)
            .contentLength(size)
            .build();
        String url = presigner.presignPutObject(b -> b.signatureDuration(URL_LIFETIME).putObjectRequest(put))
            .url().toString();
        return new PresignedUpload(url, Map.of("Content-Type", contentType, "Content-Length", Long.toString(size)));
    }

    /** The uploaded bytes. The size is checked again here: the object is what counts. */
    public byte[] read(UUID uploadId, long maxBytes) {
        try (ResponseInputStream<GetObjectResponse> in = s3.getObject(b -> b.bucket(bucket).key(key(uploadId)))) {
            Long length = in.response().contentLength();
            if (length != null && length > maxBytes) {
                throw new FileTooLargeException("The file exceeds the maximum of " + maxBytes + " bytes");
            }
            return in.readAllBytes();
        } catch (NoSuchKeyException missing) {
            throw new UploadNotFoundException();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    public void delete(UUID uploadId) {
        s3.deleteObject(b -> b.bucket(bucket).key(key(uploadId)));
    }

    private static String key(UUID uploadId) {
        return "uploads/" + uploadId + ".csv";
    }
}
