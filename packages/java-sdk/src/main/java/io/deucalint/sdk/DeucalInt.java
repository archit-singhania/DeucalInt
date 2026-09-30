package io.deucalint.sdk;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.time.Instant;
import java.util.*;

/** Java 21 SDK. Add Jackson databind; caller owns scheduling and durable buffering. */
public final class DeucalInt {

  private final String endpoint,
    token,
    session = UUID.randomUUID().toString();
  private final List<Map<String, Object>> queue = new ArrayList<>();
  private final HttpClient client = HttpClient.newHttpClient();
  private final ObjectMapper json = new ObjectMapper();

  public DeucalInt(String endpoint, String publicToken) {
    this.endpoint = endpoint;
    this.token = publicToken;
  }

  public synchronized void track(String name, String visitor, Map<String, Object> properties) {
    queue.add(
      Map.of(
        "eventId",
        UUID.randomUUID().toString(),
        "schemaVersion",
        1,
        "type",
        "product",
        "name",
        name,
        "timestamp",
        Instant.now().toString(),
        "anonymousId",
        visitor,
        "sessionId",
        session,
        "properties",
        properties
      )
    );
  }

  public synchronized void flush() throws Exception {
    while (!queue.isEmpty()) {
      var batch = new ArrayList<>(queue.subList(0, Math.min(queue.size(), 100)));
      var request = HttpRequest.newBuilder(URI.create(endpoint + "/v1/batch"))
        .timeout(Duration.ofSeconds(15))
        .header("Content-Type", "application/json")
        .POST(
          HttpRequest.BodyPublishers.ofString(
            json.writeValueAsString(Map.of("projectToken", token, "events", batch))
          )
        )
        .build();
      var response = client.send(request, HttpResponse.BodyHandlers.discarding());
      if (response.statusCode() != 202) throw new IllegalStateException(
        "Collector status " + response.statusCode() + "; retry flush with the same queued IDs"
      );
      queue.subList(0, batch.size()).clear();
    }
  }
}
