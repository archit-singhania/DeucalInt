package io.deucalint;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.http.*;
import java.nio.file.*;
import java.time.Duration;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.utility.DockerImageName;

/** Exercises the actual SQL on the same ClickHouse version as Compose, when Docker is available. */
@Testcontainers(disabledWithoutDocker = true)
class WarehouseContainerTest {

  @Container
  static GenericContainer<?> warehouse = new GenericContainer<>(
    DockerImageName.parse("clickhouse/clickhouse-server:25.8")
  )
    .withEnv("CLICKHOUSE_USER", "deucalint")
    .withEnv("CLICKHOUSE_PASSWORD", "test-only")
    .withEnv("CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT", "1")
    .withExposedPorts(8123)
    .waitingFor(Wait.forHttp("/ping").forStatusCode(200));

  String query(WarehouseQueries.Query query) throws Exception {
    var uri = Platform.warehouseUri(
      "http://" + warehouse.getHost() + ":" + warehouse.getMappedPort(8123),
      query.parameters()
    );
    var request = HttpRequest.newBuilder(uri)
      .timeout(Duration.ofSeconds(20))
      .header("X-ClickHouse-User", "deucalint")
      .header("X-ClickHouse-Key", "test-only")
      .POST(HttpRequest.BodyPublishers.ofString(query.sql()))
      .build();
    var response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
    assertEquals(200, response.statusCode(), response.body());
    return response.body();
  }

  String query(String sql) throws Exception {
    return query(new WarehouseQueries.Query(sql, Map.of()));
  }

  ObjectNode row(
    String id,
    String session,
    String type,
    String name,
    long timestamp,
    String country,
    int version
  ) {
    ObjectNode body = Platform.JSON.createObjectNode();
    body.putObject("context").put("country", country).put("browser", "Chrome");
    body.putObject("device").put("type", "Desktop");
    body.putObject("page").put("path", "/pricing");
    body.putObject("properties").put("amount", name.equals("purchase_completed") ? 120 : 0);
    ObjectNode row = Platform.JSON.createObjectNode();
    return row
      .put("project_id", "tenant-one")
      .put("event_id", id)
      .put("session_id", session)
      .put("visitor_id", session)
      .put("timestamp", timestamp / 1000.0)
      .put("type", type)
      .put("name", name)
      .put("version", version)
      .put("body", body.toString());
  }

  @Test
  void aggregatesAreTenantScopedDeduplicatedAndSegmented() throws Exception {
    String migration = Files.readString(Path.of("../../database/clickhouse/001-init.sql"));
    for (String statement : migration.split(";")) if (!statement.isBlank()) query(statement);
    long now = System.currentTimeMillis(),
      base = now - 60000;
    ObjectNode first = row("e1", "a", "page", "page_view", base, "India", 1);
    ObjectNode duplicate = first.deepCopy();
    duplicate.put("version", 2);
    ObjectNode foreign = first.deepCopy();
    foreign.put("project_id", "another-tenant");
    query(
      "INSERT INTO deucalint.events FORMAT JSONEachRow\n" +
        String.join(
          "\n",
          first.toString(),
          duplicate.toString(),
          foreign.toString(),
          row("e2", "a", "page", "page_view", base + 10000, "India", 1).toString(),
          row("e3", "a", "product", "purchase_completed", base + 20000, "India", 1).toString(),
          row("e4", "b", "page", "page_view", base, "US", 1).toString(),
          row("e5", "release", "deployment", "release", base, "Unknown", 1).toString(),
          row("e6", "previous", "page", "page_view", now - 8 * 86400000L, "US", 1).toString()
        )
    );
    var queries = new WarehouseQueries("tenant-one", 7, now, null);
    JsonNode result = queries.response(
      "tenant-one",
      Platform.JSON.readTree(query(queries.metrics())),
      Platform.JSON.readTree(query(queries.breakdowns()))
    );
    assertEquals(5, result.path("metrics").path("events").asInt());
    assertEquals(2, result.path("metrics").path("sessions").asInt());
    assertEquals(3, result.path("metrics").path("pageviews").asInt());
    assertEquals(50, result.path("metrics").path("conversion").asDouble());
    assertEquals(50, result.path("metrics").path("bounce").asDouble());
    assertEquals(10, result.path("metrics").path("duration").asDouble());
    assertEquals(120, result.path("metrics").path("revenue").asDouble());
    assertEquals(1, result.path("previous").path("events").asInt());
    var ast = Platform.JSON.createObjectNode()
      .put("dimension", "country")
      .put("operator", "eq")
      .put("value", "India");
    queries = new WarehouseQueries("tenant-one", 7, now, ast);
    result = queries.response(
      "tenant-one",
      Platform.JSON.readTree(query(queries.metrics())),
      Platform.JSON.readTree(query(queries.breakdowns()))
    );
    assertEquals(3, result.path("metrics").path("events").asInt());
    assertEquals(100, result.path("metrics").path("conversion").asDouble());
    assertEquals(1, result.path("distributions").path("country").size());
  }
}
