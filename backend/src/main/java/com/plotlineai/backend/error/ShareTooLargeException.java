package com.plotlineai.backend.error;

/** The chart's snapshot would not fit in one DynamoDB item, even compressed. */
public class ShareTooLargeException extends RuntimeException {

    public ShareTooLargeException() {
        super("This chart is too large to share");
    }
}
