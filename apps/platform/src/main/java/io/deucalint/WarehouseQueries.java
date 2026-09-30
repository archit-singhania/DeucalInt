package io.deucalint;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;

/** Server-owned query templates. All tenant, time-window and segment values are bound parameters. */
final class WarehouseQueries {

  record Query(String sql, Map<String, String> parameters) {}

  final int days, buckets;
  final long now, cutoff, start, width;
  final Map<String, String> parameters = new LinkedHashMap<>();
  final String where;
  int expressions;

  WarehouseQueries(String project, int days, long now, JsonNode segment) {
    if (days < 1 || days > 90) throw new IllegalArgumentException("Days must be 1–90");
    this.days = days;
    this.buckets = days == 1 ? 24 : days;
    this.now = now;
    cutoff = now - days * 86400000L;
    start = cutoff - days * 86400000L;
    width = (days * 86400000L) / buckets;
    parameters.put("project", project);
    parameters.put("start", Long.toString(start));
    parameters.put("cutoff", Long.toString(cutoff));
    parameters.put("end", Long.toString(now));
    parameters.put("width", Long.toString(width));
    where =
      "project_id={project:String} AND timestamp>=fromUnixTimestamp64Milli({start:Int64}) " +
      "AND timestamp<fromUnixTimestamp64Milli({end:Int64}) AND " +
      (segment == null ? "1" : segment(segment, 0));
  }

  static final Map<String, String> DIMENSIONS = Map.of(
    "browser",
    "if(empty(JSONExtractString(body,'context','browser')),'Unknown',JSONExtractString(body,'context','browser'))",
    "device",
    "if(empty(JSONExtractString(body,'device','type')),'Unknown',JSONExtractString(body,'device','type'))",
    "country",
    "if(empty(JSONExtractString(body,'context','country')),'Unknown',JSONExtractString(body,'context','country'))",
    "release",
    "if(empty(JSONExtractString(body,'context','release')),'Unknown',JSONExtractString(body,'context','release'))",
    "path",
    "if(empty(JSONExtractString(body,'page','path')),'/',JSONExtractString(body,'page','path'))",
    "name",
    "name",
    "variant",
    "if(empty(JSONExtractString(body,'properties','variant')),'Unknown',JSONExtractString(body,'properties','variant'))"
  );

  String bind(JsonNode value) {
    if (!value.isTextual() || value.asText().length() > 200) throw new IllegalArgumentException(
      "Invalid segment value"
    );
    String key = "s" + parameters.size();
    parameters.put(key, value.asText());
    return "{" + key + ":String}";
  }

  String segment(JsonNode node, int depth) {
    if (!node.isObject() || depth > 4 || ++expressions > 60) throw new IllegalArgumentException(
      "Invalid segment complexity"
    );
    if (node.has("and")) {
      JsonNode terms = node.get("and");
      if (
        node.size() != 1 || !terms.isArray() || terms.size() > 10
      ) throw new IllegalArgumentException("Invalid conjunction");
      List<String> clauses = new ArrayList<>();
      for (JsonNode term : terms) clauses.add(segment(term, depth + 1));
      return clauses.isEmpty() ? "1" : "(" + String.join(" AND ", clauses) + ")";
    }
    if (node.size() != 3 || !node.has("value")) throw new IllegalArgumentException(
      "Invalid segment"
    );
    String dimension = DIMENSIONS.get(node.path("dimension").asText());
    if (dimension == null) throw new IllegalArgumentException("Unsupported dimension");
    String operator = node.path("operator").asText();
    if (operator.equals("in")) {
      JsonNode values = node.get("value");
      if (!values.isArray() || values.size() > 30) throw new IllegalArgumentException(
        "Invalid segment values"
      );
      List<String> bound = new ArrayList<>();
      for (JsonNode value : values) bound.add(bind(value));
      return bound.isEmpty() ? "0" : dimension + " IN (" + String.join(",", bound) + ")";
    }
    if (!Set.of("eq", "neq").contains(operator)) throw new IllegalArgumentException(
      "Unsupported segment operator"
    );
    return dimension + (operator.equals("eq") ? "=" : "!=") + bind(node.get("value"));
  }

  String scoped() {
    return "SELECT * FROM deucalint.events FINAL WHERE " + where;
  }

  static final String SETTINGS =
    " SETTINGS max_execution_time=10,max_memory_usage=536870912,max_rows_to_read=10000000,read_overflow_mode='throw',timeout_overflow_mode='throw',output_format_json_quote_64bit_integers=0 FORMAT JSON";

  Query metrics() {
    String sql =
      """
      WITH scoped AS (%s), bucketed AS (
        SELECT *,if(timestamp>=fromUnixTimestamp64Milli({cutoff:Int64}),'current','previous') AS period,
          arrayJoin([toInt32(-1),toInt32(intDiv(toUnixTimestamp64Milli(timestamp)-if(timestamp>=fromUnixTimestamp64Milli({cutoff:Int64}),{cutoff:Int64},{start:Int64}),{width:Int64}))]) AS bucket
        FROM scoped
      ), event_stats AS (
        SELECT period,bucket,count() AS events,uniqExactIf(visitor_id,type!='deployment') AS visitors,
          uniqExactIf(session_id,type!='deployment') AS sessions,countIf(type='page') AS pageviews,
          uniqExactIf(session_id,name='purchase_completed') AS conversions,countIf(type='error') AS errors,
          if(countIf(type='network' AND isNotNull(toFloat64OrNull(JSONExtractRaw(body,'properties','duration'))))=0,0,
            quantileExactLowIf(0.95)(ifNull(toFloat64OrNull(JSONExtractRaw(body,'properties','duration')),0),type='network' AND isNotNull(toFloat64OrNull(JSONExtractRaw(body,'properties','duration'))))) AS latency,
          round(sumIf(ifNull(toFloat64OrNull(JSONExtractRaw(body,'properties','amount')),0),name='purchase_completed'),2) AS revenue,
          max(JSONExtractBool(body,'context','sample')) AS sample
        FROM bucketed GROUP BY period,bucket
      ), session_stats AS (
        SELECT period,bucket,round(100.0*countIf(pages<=1)/count(),2) AS bounce,
          round(avg(duration)) AS duration
        FROM (SELECT period,bucket,session_id,countIf(type='page') AS pages,
          (max(toUnixTimestamp64Milli(timestamp))-min(toUnixTimestamp64Milli(timestamp)))/1000.0 AS duration
          FROM bucketed WHERE type!='deployment' GROUP BY period,bucket,session_id)
        GROUP BY period,bucket
      ) SELECT e.*,if(e.sessions=0,0,round(100.0*e.conversions/e.sessions,2)) AS conversion,
        ifNull(s.bounce,0) AS bounce,ifNull(s.duration,0) AS duration
        FROM event_stats e LEFT JOIN session_stats s ON e.period=s.period AND e.bucket=s.bucket
        ORDER BY e.period,e.bucket
      """.formatted(scoped()) + SETTINGS;
    return new Query(sql, Map.copyOf(parameters));
  }

  Query breakdowns() {
    String sql =
      """
      WITH scoped AS (%s AND timestamp>=fromUnixTimestamp64Milli({cutoff:Int64})), firsts AS (
        SELECT session_id,argMin(%s,tuple(timestamp,event_id)) AS browser,
          argMin(%s,tuple(timestamp,event_id)) AS device,argMin(%s,tuple(timestamp,event_id)) AS country
          FROM scoped WHERE type!='deployment' GROUP BY session_id
      ) SELECT kind,name,count FROM (
        SELECT item.1 AS kind,item.2 AS name,count() AS count FROM
          (SELECT arrayJoin([tuple('browser',browser),tuple('device',device),tuple('country',country)]) AS item FROM firsts)
          GROUP BY kind,name
        UNION ALL SELECT 'pages' AS kind,%s AS name,count() AS count FROM scoped WHERE type='page' GROUP BY name
      ) ORDER BY kind,count DESC,name LIMIT 7 BY kind
      """.formatted(
        scoped(),
        DIMENSIONS.get("browser"),
        DIMENSIONS.get("device"),
        DIMENSIONS.get("country"),
        DIMENSIONS.get("path")
      ) + SETTINGS;
    return new Query(sql, Map.copyOf(parameters));
  }

  static ObjectNode emptyMetrics() {
    ObjectNode out = Platform.JSON.createObjectNode();
    for (String key : List.of(
      "events",
      "visitors",
      "sessions",
      "pageviews",
      "conversions",
      "conversion",
      "errors",
      "bounce",
      "duration",
      "latency",
      "revenue"
    ))
      out.put(key, 0);
    return out;
  }

  ObjectNode response(String project, JsonNode metricRows, JsonNode breakdownRows) {
    ObjectNode out = Platform.JSON.createObjectNode();
    out.set("metrics", emptyMetrics());
    out.set("previous", emptyMetrics());
    ArrayNode current = out.putArray("series"),
      previous = out.putArray("previousSeries");
    DateTimeFormatter format = DateTimeFormatter.ofPattern(
      days == 1 ? "HH:mm" : "MMM dd",
      Locale.ENGLISH
    ).withZone(ZoneOffset.UTC);
    for (int i = 0; i < buckets; i++) {
      String label = format.format(Instant.ofEpochMilli(cutoff + i * width));
      current.add(emptyMetrics().put("label", label));
      previous.add(emptyMetrics().put("label", label));
    }
    boolean sample = false;
    for (JsonNode row : metricRows.path("data")) {
      boolean isCurrent = row.path("period").asText().equals("current");
      int bucket = row.path("bucket").asInt();
      ObjectNode metric = emptyMetrics();
      for (Iterator<String> keys = metric.fieldNames(); keys.hasNext(); ) {
        String key = keys.next();
        if (row.has(key)) metric.set(key, row.get(key));
      }
      if (bucket == -1) out.set(isCurrent ? "metrics" : "previous", metric);
      else if (bucket >= 0 && bucket < buckets) {
        ArrayNode target = isCurrent ? current : previous;
        metric.put("label", target.get(bucket).path("label").asText());
        target.set(bucket, metric);
      }
      if (isCurrent) sample |= row.path("sample").asInt() > 0;
    }
    ObjectNode distributions = out.putObject("distributions");
    for (String key : List.of("browser", "device", "country")) distributions.putArray(key);
    ArrayNode pages = out.putArray("pages");
    for (JsonNode row : breakdownRows.path("data")) {
      String kind = row.path("kind").asText();
      ArrayNode target = kind.equals("pages") ? pages : (ArrayNode) distributions.get(kind);
      if (target != null) target.add(
        Platform.JSON.createObjectNode()
          .put("name", row.path("name").asText())
          .put("count", row.path("count").asLong())
      );
    }
    out.put("sample", sample);
    out.put("updatedAt", Instant.ofEpochMilli(now).toString());
    out.put("project", project);
    out
      .putObject("query")
      .put("engine", "clickhouse")
      .put("aggregated", true)
      .put("maxExecutionSeconds", 10)
      .put("maxRowsRead", 10000000);
    return out;
  }
}
