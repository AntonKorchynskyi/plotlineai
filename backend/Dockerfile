# syntax=docker/dockerfile:1

FROM eclipse-temurin:25-jdk AS build
WORKDIR /app
COPY .mvn/ .mvn/
COPY mvnw pom.xml ./
RUN ./mvnw -q -B dependency:go-offline
COPY src/ src/
RUN ./mvnw -q -B clean package -DskipTests

FROM eclipse-temurin:25-jre AS runtime
WORKDIR /app
# upgrade applies Ubuntu's security fixes released since the base image was built, so a
# fixed OS package does not wait for the next eclipse-temurin rebuild.
RUN groupadd -r spring && useradd -r -g spring spring \
 && apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/target/backend-0.0.1-SNAPSHOT.jar app.jar
USER spring
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
