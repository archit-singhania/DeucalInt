CREATE DATABASE IF NOT EXISTS deucalint;
CREATE TABLE IF NOT EXISTS deucalint.events (
 project_id String, event_id String, session_id String, visitor_id String,
 timestamp DateTime64(3,'UTC'), type LowCardinality(String), name LowCardinality(String), body String, version UInt64
) ENGINE=ReplacingMergeTree(version) PARTITION BY toYYYYMM(timestamp)
ORDER BY (project_id,event_id) TTL timestamp + INTERVAL 90 DAY DELETE;
-- Exact unique event states make aggregate event counts insensitive to redelivery.
CREATE TABLE IF NOT EXISTS deucalint.events_1m (
 project_id String, minute DateTime('UTC'), type LowCardinality(String), event_ids AggregateFunction(uniqExact,String)
) ENGINE=AggregatingMergeTree ORDER BY (project_id,minute,type) TTL minute + INTERVAL 90 DAY;
CREATE MATERIALIZED VIEW IF NOT EXISTS deucalint.events_1m_mv TO deucalint.events_1m AS
SELECT project_id,toStartOfMinute(timestamp) AS minute,type,uniqExactState(event_id) AS event_ids
FROM deucalint.events GROUP BY project_id,minute,type;
