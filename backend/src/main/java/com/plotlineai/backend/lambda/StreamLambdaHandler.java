package com.plotlineai.backend.lambda;

import com.amazonaws.serverless.exceptions.ContainerInitializationException;
import com.amazonaws.serverless.proxy.model.AwsProxyResponse;
import com.amazonaws.serverless.proxy.model.HttpApiV2ProxyRequest;
import com.amazonaws.serverless.proxy.spring.SpringBootLambdaContainerHandler;
import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestStreamHandler;
import com.plotlineai.backend.BackendApplication;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * The api's Lambda entry point. Function URL events use API Gateway's HTTP API payload 2.0,
 * which the container translates into servlet requests for the unchanged Spring MVC controllers.
 *
 * <p>The Spring context starts in the static initializer, so with SnapStart it is part of the
 * snapshot: a cold start resumes a context that is already up, gallery rendered and SDK clients
 * built.
 */
public class StreamLambdaHandler implements RequestStreamHandler {

    private static final SpringBootLambdaContainerHandler<HttpApiV2ProxyRequest, AwsProxyResponse> HANDLER;

    static {
        // A separate management port makes Spring start a second, servlet-less context, which
        // fails inside Lambda ("No ServletContext set"). Actuator over HTTP has no use here anyway.
        if (System.getProperty("management.server.port") == null && System.getenv("MANAGEMENT_PORT") == null) {
            System.setProperty("management.server.port", "-1");
        }
        try {
            HANDLER = SpringBootLambdaContainerHandler.getHttpApiV2ProxyHandler(BackendApplication.class);
        } catch (ContainerInitializationException e) {
            throw new IllegalStateException("Could not start the Spring Boot application", e);
        }
    }

    @Override
    public void handleRequest(InputStream input, OutputStream output, Context context) throws IOException {
        HANDLER.proxyStream(input, output, context);
    }
}
