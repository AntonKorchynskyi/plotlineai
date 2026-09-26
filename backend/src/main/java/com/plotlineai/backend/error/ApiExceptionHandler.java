package com.plotlineai.backend.error;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

@RestControllerAdvice
public class ApiExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(InvalidFileTypeException.class)
    public ResponseEntity<ErrorResponse> onInvalidFileType(InvalidFileTypeException ex) {
        return body(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "INVALID_FILE_TYPE", ex.getMessage());
    }

    @ExceptionHandler(FileTooLargeException.class)
    public ResponseEntity<ErrorResponse> onFileTooLarge(FileTooLargeException ex) {
        return body(HttpStatus.PAYLOAD_TOO_LARGE, "FILE_TOO_LARGE", ex.getMessage());
    }

    /** Spring's own message names its internals; the uploader only needs the limit. */
    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<ErrorResponse> onUploadTooLarge(MaxUploadSizeExceededException ex) {
        return body(HttpStatus.PAYLOAD_TOO_LARGE, "FILE_TOO_LARGE",
            "The file exceeds the maximum upload size of 5 MB");
    }

    @ExceptionHandler(CsvParseException.class)
    public ResponseEntity<ErrorResponse> onMalformedCsv(CsvParseException ex) {
        return body(HttpStatus.UNPROCESSABLE_ENTITY, "MALFORMED_CSV", ex.getMessage());
    }

    @ExceptionHandler(CapExceededException.class)
    public ResponseEntity<ErrorResponse> onCapExceeded(CapExceededException ex) {
        return body(HttpStatus.UNPROCESSABLE_ENTITY, "CAP_EXCEEDED", ex.getMessage());
    }

    @ExceptionHandler(StorageFullException.class)
    public ResponseEntity<ErrorResponse> onStorageFull(StorageFullException ex) {
        return body(HttpStatus.SERVICE_UNAVAILABLE, "STORAGE_FULL", "Dataset storage is full");
    }

    @ExceptionHandler(NotFoundException.class)
    public ResponseEntity<ErrorResponse> onNotFound(NotFoundException ex) {
        return body(HttpStatus.NOT_FOUND, "NOT_FOUND", ex.getMessage());
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ErrorResponse> onMalformedPathVariable(MethodArgumentTypeMismatchException ex) {
        return body(HttpStatus.NOT_FOUND, "NOT_FOUND", "Resource not found");
    }

    @ExceptionHandler(InvalidChartSpecException.class)
    public ResponseEntity<ErrorResponse> onInvalidChartSpec(InvalidChartSpecException ex) {
        return body(HttpStatus.BAD_REQUEST, "INVALID_CHART_SPEC", ex.getMessage());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> onBeanValidationFailure(MethodArgumentNotValidException ex) {
        return body(HttpStatus.BAD_REQUEST, "INVALID_CHART_SPEC", "The chart spec is invalid");
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ErrorResponse> onUnreadableBody(HttpMessageNotReadableException ex) {
        return body(HttpStatus.BAD_REQUEST, "INVALID_CHART_SPEC",
            "The request body could not be parsed");
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> onUnexpected(Exception ex) {
        if (ex instanceof org.springframework.web.ErrorResponse er
                && er.getStatusCode().is4xxClientError()) {
            HttpStatusCode status = er.getStatusCode();
            String code = status.value() == HttpStatus.NOT_FOUND.value() ? "NOT_FOUND" : "INVALID_REQUEST";
            log.warn("Client error while processing request: {} ({})",
                status, ex.getClass().getSimpleName());
            return ResponseEntity.status(status)
                .body(new ErrorResponse(code, "The request could not be processed"));
        }
        log.error("Unhandled exception while processing request", ex);
        return body(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL", "An unexpected error occurred");
    }

    private static ResponseEntity<ErrorResponse> body(HttpStatus status, String code, String message) {
        return ResponseEntity.status(status).body(new ErrorResponse(code, message));
    }
}
