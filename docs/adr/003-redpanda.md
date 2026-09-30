# ADR 003 — Use a Kafka-compatible broker

Status: accepted for the current development implementation.

## Decision

Redpanda is the distributed development broker. Java clients use standard Kafka protocols with project/visitor partition keys.

## Consequences and limits

One local broker demonstrates the data path, not fault-tolerant quorum operation. Production replication and partition sizing require measurement.
