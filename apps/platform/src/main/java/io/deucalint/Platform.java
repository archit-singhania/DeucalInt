package io.deucalint;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;
import org.apache.kafka.clients.consumer.*;
import org.apache.kafka.clients.producer.*;
import org.apache.kafka.common.serialization.*;
import org.springframework.boot.*;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.reactive.config.CorsRegistry;
import org.springframework.web.reactive.config.WebFluxConfigurer;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

@SpringBootApplication
@RestController
public class Platform implements WebFluxConfigurer {

  @Override
  public void addCorsMappings(CorsRegistry registry) {
    registry
      .addMapping("/v1/batch")
      .allowedOrigins(
        env("ALLOWED_ORIGINS", "http://localhost:4200,http://127.0.0.1:4200").split(",")
      )
      .allowedMethods("POST", "OPTIONS")
      .allowedHeaders("Content-Type")
      .maxAge(600);
  }

  static String env(String name, String fallback) {
    return System.getenv().getOrDefault(name, fallback);
  }

  static final String ROLE = env("SERVICE_ROLE", "collector"),
    TOPIC = "analytics.events.raw";
  static final ObjectMapper JSON = new ObjectMapper();
  static final Set<String> TYPES = Set.of(
    "product",
    "page",
    "session",
    "performance",
    "error",
    "network",
    "replay",
    "deployment",
    "experiment",
    "identity"
  );
  static final Pattern SENSITIVE = Pattern.compile(
    "password|secret|token|authorization|cookie|email|phone|credit|card|cvv|^input$|^value$|^text$|^html$|^stack$|^message$",
    Pattern.CASE_INSENSITIVE
  );
  final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
  final MeterRegistry meters;
  KafkaProducer<String, String> producer;
  KafkaConsumer<String, String> consumer;
  final AtomicBoolean running = new AtomicBoolean(true);
  Thread worker;
  final Map<String, Deque<Long>> limits = new ConcurrentHashMap<>();

  public Platform(MeterRegistry meters) {
    this.meters = meters;
  }

  public static void main(String[] args) {
    SpringApplication.run(Platform.class, args);
  }

  static String sha(String input) throws Exception {
    return HexFormat.of().formatHex(
      MessageDigest.getInstance("SHA-256").digest(input.getBytes(StandardCharsets.UTF_8))
    );
  }

  Connection db() throws SQLException {
    return DriverManager.getConnection(
      env("POSTGRES_URL", "jdbc:postgresql://localhost:5432/deucalint"),
      env("POSTGRES_USER", "deucalint"),
      env("POSTGRES_PASSWORD", "local-development")
    );
  }

  @PostConstruct
  void start() {
    if (ROLE.equals("collector") || ROLE.equals("worker")) {
      Properties p = new Properties();
      p.put("bootstrap.servers", env("KAFKA_BOOTSTRAP_SERVERS", "localhost:19092"));
      p.put("key.serializer", StringSerializer.class);
      p.put("value.serializer", StringSerializer.class);
      p.put("acks", "all");
      p.put("enable.idempotence", "true");
      p.put("delivery.timeout.ms", "30000");
      p.put("max.block.ms", "5000");
      producer = new KafkaProducer<>(p);
    }
    if (ROLE.equals("worker")) {
      worker = Thread.ofPlatform().name("warehouse-consumer").start(this::consume);
    }
  }

  @PreDestroy
  void stop() {
    running.set(false);
    if (consumer != null) consumer.wakeup();
    try {
      if (worker != null) worker.join(20000);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
    if (producer != null) producer.close(Duration.ofSeconds(5));
  }

  static JsonNode scrub(JsonNode value, int depth) {
    if (depth > 8) return TextNode.valueOf("[depth limit]");
    if (value.isObject()) {
      ObjectNode out = JSON.createObjectNode();
      value
        .fields()
        .forEachRemaining(e ->
          out.set(
            e.getKey(),
            SENSITIVE.matcher(e.getKey()).find()
              ? TextNode.valueOf("[redacted]")
              : scrub(e.getValue(), depth + 1)
          )
        );
      return out;
    }
    if (value.isArray()) {
      ArrayNode out = JSON.createArrayNode();
      value.forEach(e -> out.add(scrub(e, depth + 1)));
      return out;
    }
    if (value.isTextual()) return TextNode.valueOf(
      value
        .asText()
        .replaceAll("[\\w.+-]+@[\\w.-]+\\.[A-Za-z]{2,}", "[email]")
        .replaceAll("\\b(?:\\d[ -]*?){13,19}\\b", "[number]")
        .replaceAll("(?i)bearer\\s+\\S+", "[credential]")
    );
    return value;
  }

  static ObjectNode validate(JsonNode e) {
    if (!e.isObject()) throw new IllegalArgumentException("Invalid event");
    Set<String> allowed = Set.of(
      "eventId",
      "schemaVersion",
      "type",
      "name",
      "timestamp",
      "anonymousId",
      "sessionId",
      "properties",
      "page",
      "context",
      "device"
    );
    e.fieldNames().forEachRemaining(key -> {
      if (!allowed.contains(key)) throw new IllegalArgumentException("Unknown event field");
    });
    for (String key : List.of("eventId", "name", "anonymousId", "sessionId"))
      if (
        !e.path(key).isTextual() ||
        e.path(key).asText().isBlank() ||
        e.path(key).asText().length() > 128
      ) throw new IllegalArgumentException("Invalid " + key);
    if (
      e.path("schemaVersion").asInt() != 1 || !TYPES.contains(e.path("type").asText())
    ) throw new IllegalArgumentException("Unsupported event schema");
    Instant t = Instant.parse(e.path("timestamp").asText());
    if (
      t.isAfter(Instant.now().plusSeconds(300)) ||
      t.isBefore(Instant.now().minusSeconds(366L * 86400))
    ) throw new IllegalArgumentException("Timestamp out of range");
    for (String key : List.of("properties", "page", "context", "device"))
      if (e.has(key) && !e.get(key).isObject()) throw new IllegalArgumentException(
        "Invalid " + key
      );
    ObjectNode out = (ObjectNode) scrub(e, 0);
    if (out.has("page")) {
      ObjectNode page = (ObjectNode) out.get("page");
      page.remove("title");
      for (String key : List.of("url", "path", "referrer"))
        if (page.has(key)) page.put(key, page.get(key).asText().split("[?#]", 2)[0]);
    }
    // Distributed replay accepts only layout geometry, never serialized DOM or text.
    if (out.path("type").asText().equals("replay")) {
      ObjectNode props = JSON.createObjectNode();
      ArrayNode nodes = JSON.createArrayNode();
      for (JsonNode node : out.path("properties").path("nodes")) {
        if (nodes.size() >= 100) break;
        ObjectNode safe = JSON.createObjectNode();
        safe.put(
          "tag",
          Set.of(
            "div",
            "button",
            "input",
            "img",
            "a",
            "p",
            "h1",
            "h2",
            "header",
            "section"
          ).contains(node.path("tag").asText())
            ? node.path("tag").asText()
            : "div"
        );
        for (String k : List.of("x", "y", "width", "height"))
          safe.put(k, Math.max(0, Math.min(4000, node.path(k).asDouble())));
        safe.put("masked", true);
        nodes.add(safe);
      }
      props.set("nodes", nodes);
      props.put(
        "width",
        Math.max(1, Math.min(4000, out.path("properties").path("width").asDouble(1440)))
      );
      out.set("properties", props);
    }
    return out;
  }

  String projectForToken(String token, String scope) throws Exception {
    try (
      Connection c = db();
      PreparedStatement p = c.prepareStatement(
        "SELECT project_id FROM project_tokens WHERE token_hash=? AND scope=? AND revoked=false"
      )
    ) {
      p.setString(1, sha(token));
      p.setString(2, scope);
      try (ResultSet r = p.executeQuery()) {
        if (!r.next()) throw new ResponseStatusException(
          HttpStatus.UNAUTHORIZED,
          "Invalid token or scope"
        );
        return r.getString(1);
      }
    }
  }

  boolean rateLimited(String project) {
    Deque<Long> q = limits.computeIfAbsent(project, k -> new ArrayDeque<>());
    synchronized (q) {
      long now = System.currentTimeMillis();
      while (!q.isEmpty() && q.peekFirst() < now - 60000) q.removeFirst();
      if (q.size() >= 120) return true;
      q.addLast(now);
      return false;
    }
  }

  @PostMapping("/v1/batch")
  Mono<ResponseEntity<Map<String, Object>>> batch(
    @RequestBody JsonNode body,
    @RequestHeader(value = "Origin", required = false) String origin
  ) {
    if (!ROLE.equals("collector")) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    return Mono.fromCallable(() -> {
      if (
        origin != null &&
        !Set.of(
          env("ALLOWED_ORIGINS", "http://localhost:4200,http://127.0.0.1:4200").split(",")
        ).contains(origin)
      ) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Origin rejected");
      String project = projectForToken(body.path("projectToken").asText(), "events:write");
      if (rateLimited(project)) throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS);
      JsonNode events = body.path("events");
      if (
        !events.isArray() || events.isEmpty() || events.size() > 100
      ) throw new IllegalArgumentException("Batch requires 1–100 events");
      List<ObjectNode> validated = new ArrayList<>();
      events.forEach(e -> validated.add(validate(e)));
      List<CompletableFuture<RecordMetadata>> sends = new ArrayList<>();
      for (ObjectNode e : validated) {
        e.put("projectId", project);
        CompletableFuture<RecordMetadata> done = new CompletableFuture<>();
        producer.send(
          new ProducerRecord<>(
            TOPIC,
            project + ":" + e.path("anonymousId").asText(),
            JSON.writeValueAsString(e)
          ),
          (metadata, error) -> {
            if (error != null) done.completeExceptionally(error);
            else done.complete(metadata);
          }
        );
        sends.add(done);
      }
      CompletableFuture.allOf(sends.toArray(CompletableFuture[]::new)).get(35, TimeUnit.SECONDS);
      meters.counter("deucalint.events.received").increment(validated.size());
      return ResponseEntity.accepted().body(
        Map.<String, Object>of("accepted", validated.size(), "delivery", "at-least-once")
      );
    }).subscribeOn(Schedulers.boundedElastic());
  }

  @ExceptionHandler(IllegalArgumentException.class)
  ResponseEntity<Map<String, String>> invalid(Exception e) {
    meters.counter("deucalint.events.rejected").increment();
    return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
  }

  @ExceptionHandler({ TimeoutException.class, ExecutionException.class, SQLException.class })
  ResponseEntity<Map<String, String>> unavailable(Exception e) {
    return ResponseEntity.status(503).body(
      Map.of("error", "Dependency unavailable; retry with the same event IDs")
    );
  }

  String clickhouse(String query) throws Exception {
    HttpRequest req = HttpRequest.newBuilder(
      URI.create(env("CLICKHOUSE_URL", "http://localhost:8123"))
    )
      .timeout(Duration.ofSeconds(15))
      .header("X-ClickHouse-User", env("CLICKHOUSE_USER", "deucalint"))
      .header("X-ClickHouse-Key", env("CLICKHOUSE_PASSWORD", "local-development"))
      .POST(HttpRequest.BodyPublishers.ofString(query))
      .build();
    var response = http.send(req, HttpResponse.BodyHandlers.ofString());
    if (response.statusCode() != 200) throw new java.io.IOException(
      "Warehouse request failed: " + response.statusCode()
    );
    return response.body();
  }

  @GetMapping("/v1/analytics")
  Mono<JsonNode> analytics(
    @RequestHeader("Authorization") String authorization,
    @RequestParam(defaultValue = "7") int days
  ) {
    if (!ROLE.equals("api")) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    return Mono.fromCallable(() -> {
      if (days < 1 || days > 90) throw new IllegalArgumentException("Days must be 1–90");
      String project = projectForToken(
        authorization.replaceFirst("^Bearer ", ""),
        "analytics:read"
      );
      // Project IDs originate in metadata, not SQL supplied by users. Encode instead of interpolating raw strings.
      String hex = HexFormat.of().formatHex(project.getBytes(StandardCharsets.UTF_8));
      return JSON.readTree(
        clickhouse(
          "SELECT count() AS events,uniqExact(visitor_id) AS visitors,uniqExact(session_id) AS sessions,countIf(type='error') AS errors FROM deucalint.events FINAL WHERE project_id=unhex('" +
            hex +
            "') AND timestamp>=now()-INTERVAL " +
            days +
            " DAY FORMAT JSON"
        )
      );
    }).subscribeOn(Schedulers.boundedElastic());
  }

  @GetMapping("/v1/events")
  Mono<JsonNode> events(
    @RequestHeader("Authorization") String authorization,
    @RequestParam(defaultValue = "7") double days
  ) {
    if (!ROLE.equals("api")) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    return Mono.fromCallable(() -> {
      if (!Double.isFinite(days) || days <= 0 || days > 180) throw new IllegalArgumentException(
        "Days must be positive and <=180"
      );
      String project = projectForToken(
        authorization.replaceFirst("^Bearer ", ""),
        "analytics:read"
      );
      String hex = HexFormat.of().formatHex(project.getBytes(StandardCharsets.UTF_8));
      return JSON.readTree(
        clickhouse(
          "SELECT body FROM deucalint.events FINAL WHERE project_id=unhex('" +
            hex +
            "') AND timestamp>=now()-INTERVAL " +
            (long) Math.ceil(days * 86400) +
            " SECOND AND timestamp<=now() ORDER BY timestamp LIMIT 100001 FORMAT JSON"
        )
      );
    }).subscribeOn(Schedulers.boundedElastic());
  }

  @GetMapping("/ready")
  Mono<ResponseEntity<Map<String, String>>> ready() {
    return Mono.fromCallable(() -> {
      try (Connection c = db()) {
        c.isValid(2);
      }
      if (ROLE.equals("api") || ROLE.equals("worker")) clickhouse("SELECT 1");
      if (producer != null) producer.partitionsFor(TOPIC);
      return ResponseEntity.ok(Map.of("status", "ready", "role", ROLE));
    })
      .subscribeOn(Schedulers.boundedElastic())
      .onErrorReturn(ResponseEntity.status(503).body(Map.of("status", "dependency unavailable")));
  }

  void consume() {
    Properties p = new Properties();
    p.put("bootstrap.servers", env("KAFKA_BOOTSTRAP_SERVERS", "localhost:19092"));
    p.put("group.id", "deucalint-warehouse-v1");
    p.put("key.deserializer", StringDeserializer.class);
    p.put("value.deserializer", StringDeserializer.class);
    p.put("enable.auto.commit", "false");
    p.put("auto.offset.reset", "earliest");
    p.put("max.poll.records", "250");
    consumer = new KafkaConsumer<>(p);
    consumer.subscribe(List.of(TOPIC));
    try {
      while (running.get()) {
        ConsumerRecords<String, String> records = consumer.poll(Duration.ofSeconds(1));
        if (records.isEmpty()) continue;
        StringBuilder rows = new StringBuilder();
        for (ConsumerRecord<String, String> r : records) {
          try {
            JsonNode e = JSON.readTree(r.value());
            ObjectNode row = JSON.createObjectNode();
            row.put("project_id", e.path("projectId").asText());
            row.put("event_id", e.path("eventId").asText());
            row.put("session_id", e.path("sessionId").asText());
            row.put("visitor_id", e.path("anonymousId").asText());
            row.put(
              "timestamp",
              Instant.parse(e.path("timestamp").asText()).toEpochMilli() / 1000.0
            );
            row.put("type", e.path("type").asText());
            row.put("name", e.path("name").asText());
            row.put("body", r.value());
            row.put("version", r.offset());
            rows.append(JSON.writeValueAsString(row)).append('\n');
          } catch (Exception poison) {
            producer
              .send(new ProducerRecord<>("analytics.deadletter", r.key(), r.value()))
              .get(30, TimeUnit.SECONDS);
            meters.counter("deucalint.deadletter").increment();
          }
        }
        boolean inserted = rows.isEmpty();
        int retries = 0;
        while (!inserted && running.get()) {
          try {
            clickhouse("INSERT INTO deucalint.events FORMAT JSONEachRow\n" + rows);
            inserted = true;
          } catch (Exception unavailable) {
            meters.counter("deucalint.warehouse.retry").increment();
            Thread.sleep(Math.min(10000, 500L * (1L << Math.min(retries++, 4))));
            if (retries >= 12) throw unavailable;
          }
        }
        if (inserted) {
          consumer.commitSync();
          meters.counter("deucalint.events.processed").increment(records.count());
        }
      }
    } catch (org.apache.kafka.common.errors.WakeupException ignored) {
    } catch (Exception failure) {
      System.err.println(
        "Consumer stopped before committing: " + failure.getClass().getSimpleName()
      );
      System.exit(1);
    } finally {
      consumer.close();
    }
  }
}
