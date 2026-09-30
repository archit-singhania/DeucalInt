package io.deucalint;

import static org.junit.jupiter.api.Assertions.*;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.junit.jupiter.api.Test;

class WarehouseQueriesTest {

  @Test
  void tenantAndSegmentNeverBecomeSql() throws Exception {
    String injected = "x') OR 1=1 --";
    var ast = Platform.JSON.createObjectNode()
      .put("dimension", "country")
      .put("operator", "eq")
      .put("value", injected);
    var queries = new WarehouseQueries(injected, 7, 1700000000000L, ast);
    for (var query : new WarehouseQueries.Query[] { queries.metrics(), queries.breakdowns() }) {
      assertFalse(query.sql().contains(injected));
      assertTrue(query.sql().contains("project_id={project:String}"));
      assertTrue(query.parameters().containsValue(injected));
      assertTrue(query.sql().contains(" FINAL "));
      assertTrue(query.sql().contains("max_rows_to_read=10000000"));
    }
  }

  @Test
  void bindingsAreEncodedAsSingleUrlValues() {
    var uri = Platform.warehouseUri(
      "http://localhost:8123/?database=deucalint",
      Map.of("project", "x&param_admin=1+#é")
    );
    assertEquals(2, uri.getRawQuery().split("&").length);
    assertTrue(
      URLDecoder.decode(uri.getRawQuery(), StandardCharsets.UTF_8).endsWith(
        "param_project=x&param_admin=1+#é"
      )
    );
  }

  @Test
  void invalidWindowsAndExpressionsFailClosed() throws Exception {
    assertThrows(IllegalArgumentException.class, () -> new WarehouseQueries("p", 0, 0, null));
    assertThrows(IllegalArgumentException.class, () -> new WarehouseQueries("p", 91, 0, null));
    for (String ast : new String[] {
      "{\"sql\":\"DROP TABLE\"}",
      "{\"dimension\":\"secret\",\"operator\":\"eq\",\"value\":\"x\"}",
      "{\"dimension\":\"name\",\"operator\":\"like\",\"value\":\"x\"}",
      "{\"and\":{}}",
      "{\"dimension\":\"name\",\"operator\":\"eq\",\"value\":4}",
    }) {
      assertThrows(IllegalArgumentException.class, () ->
        new WarehouseQueries("p", 7, 0, Platform.JSON.readTree(ast))
      );
    }
  }

  @Test
  void emptyWarehouseHasDenseZeroSeries() throws Exception {
    var q = new WarehouseQueries("p", 1, 1700000000000L, null);
    var result = q.response(
      "p",
      Platform.JSON.readTree("{\"data\":[]}"),
      Platform.JSON.readTree("{\"data\":[]}")
    );
    assertEquals(24, result.path("series").size());
    assertEquals(24, result.path("previousSeries").size());
    assertEquals(0, result.path("metrics").path("sessions").asInt());
    assertTrue(result.path("query").path("aggregated").asBoolean());
  }

  @Test
  void aggregateRowsMapWithoutLeakingWarehouseFields() throws Exception {
    var q = new WarehouseQueries("p", 7, 1700000000000L, null);
    var result = q.response(
      "p",
      Platform.JSON.readTree(
        "{\"data\":[{\"period\":\"current\",\"bucket\":-1,\"sessions\":8,\"sample\":1},{\"period\":\"previous\",\"bucket\":2,\"sessions\":4}]}"
      ),
      Platform.JSON.readTree(
        "{\"data\":[{\"kind\":\"country\",\"name\":\"India\",\"count\":3},{\"kind\":\"pages\",\"name\":\"/pricing\",\"count\":5}]}"
      )
    );
    assertEquals(8, result.path("metrics").path("sessions").asInt());
    assertEquals(4, result.path("previousSeries").get(2).path("sessions").asInt());
    assertFalse(result.path("metrics").has("bucket"));
    assertEquals(
      "India",
      result.path("distributions").path("country").get(0).path("name").asText()
    );
    assertEquals(5, result.path("pages").get(0).path("count").asInt());
    assertTrue(result.path("sample").asBoolean());
  }
}
