#!/usr/bin/env bash
# A local Kafka "ecosystem" for developing the Kafka console against: one broker
# (KRaft, ACLs on — anonymous is a super user, so nothing is locked out),
# Schema Registry, Kafka Connect and ksqlDB, on their own Docker network.
# Run two to try more than one cluster side by side.
#
#   scripts/dev/kafka/stack.sh up 1      # start stack 1
#   scripts/dev/kafka/stack.sh down 2    # remove stack 2 (its data goes with it)
#   scripts/dev/kafka/stack.sh ports 2   # what to put in the connection form
#
# Ports, stack N:
#   Kafka            localhost:3909(5+N)        39096, 39097
#   Schema Registry  http://localhost:38(0+N)81 38081, 38181
#   Kafka Connect    http://localhost:38(0+N)83 38083, 38183
#   ksqlDB           http://localhost:38(0+N)88 38088, 38188
#
# Heaps are capped so two stacks fit in Docker Desktop's default 8 GB.
# Fill one with sample data: node --env-file=.env scripts/dev/kafka/seed.mjs <N>

set -euo pipefail

action=${1:-}
n=${2:-1}
case "$n" in 1 | 2 | 3) ;; *) echo "stack number is 1, 2 or 3" >&2 && exit 1 ;; esac

net="tabletsgo-eco$n"
name() { echo "tabletsgo-eco$n-$1"; }
kafka_port=$((39095 + n))
sr_port=$((37981 + 100 * n))
connect_port=$((37983 + 100 * n))
ksql_port=$((37988 + 100 * n))

wait_for() { # url, label
  for _ in $(seq 1 90); do
    curl -sf "$1" >/dev/null && return 0
    sleep 2
  done
  echo "$2 did not come up — docker logs $3" >&2
  return 1
}

ports() {
  cat <<EOF
Stack $n
  Bootstrap servers    localhost:$kafka_port
  Schema Registry URL  http://localhost:$sr_port
  Kafka Connect URL    http://localhost:$connect_port
  ksqlDB URL           http://localhost:$ksql_port
  (no authentication, TLS off, no service users)
EOF
}

up() {
  docker network create "$net" >/dev/null 2>&1 || true

  docker run -d --name "$(name kafka)" --network "$net" --network-alias kafka -p "$kafka_port:$kafka_port" \
    -e KAFKA_HEAP_OPTS="-Xms256m -Xmx512m" \
    -e KAFKA_NODE_ID=1 -e KAFKA_PROCESS_ROLES=broker,controller -e KAFKA_CONTROLLER_QUORUM_VOTERS=1@kafka:9093 \
    -e KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER \
    -e KAFKA_LISTENERS="INTERNAL://:29092,EXTERNAL://:$kafka_port,CONTROLLER://:9093" \
    -e KAFKA_ADVERTISED_LISTENERS="INTERNAL://kafka:29092,EXTERNAL://localhost:$kafka_port" \
    -e KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,INTERNAL:PLAINTEXT,EXTERNAL:PLAINTEXT \
    -e KAFKA_INTER_BROKER_LISTENER_NAME=INTERNAL \
    -e KAFKA_AUTHORIZER_CLASS_NAME=org.apache.kafka.metadata.authorizer.StandardAuthorizer \
    -e KAFKA_SUPER_USERS=User:ANONYMOUS -e KAFKA_ALLOW_EVERYONE_IF_NO_ACL_FOUND=true \
    -e KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1 -e KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1 \
    -e KAFKA_TRANSACTION_STATE_LOG_MIN_ISR=1 -e KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS=0 \
    apache/kafka:3.9.1 >/dev/null
  # The others need the broker's metadata log up first.
  for _ in $(seq 1 60); do
    # Not grep -q: closing the pipe early fails the pipeline under pipefail.
    docker logs "$(name kafka)" 2>&1 | grep "Kafka Server started" >/dev/null && break
    sleep 1
  done

  docker run -d --name "$(name sr)" --network "$net" --network-alias schema-registry -p "$sr_port:8081" \
    -e SCHEMA_REGISTRY_HEAP_OPTS="-Xms128m -Xmx256m" \
    -e SCHEMA_REGISTRY_HOST_NAME=schema-registry -e SCHEMA_REGISTRY_LISTENERS=http://0.0.0.0:8081 \
    -e SCHEMA_REGISTRY_KAFKASTORE_BOOTSTRAP_SERVERS=kafka:29092 \
    confluentinc/cp-schema-registry:7.7.1 >/dev/null

  docker run -d --name "$(name connect)" --network "$net" -p "$connect_port:8083" \
    -e KAFKA_HEAP_OPTS="-Xms256m -Xmx512m" \
    -e CONNECT_BOOTSTRAP_SERVERS=kafka:29092 -e CONNECT_REST_ADVERTISED_HOST_NAME="connect-$n" -e CONNECT_GROUP_ID=tg-connect \
    -e CONNECT_CONFIG_STORAGE_TOPIC=_tg-connect-configs -e CONNECT_OFFSET_STORAGE_TOPIC=_tg-connect-offsets \
    -e CONNECT_STATUS_STORAGE_TOPIC=_tg-connect-status -e CONNECT_CONFIG_STORAGE_REPLICATION_FACTOR=1 \
    -e CONNECT_OFFSET_STORAGE_REPLICATION_FACTOR=1 -e CONNECT_STATUS_STORAGE_REPLICATION_FACTOR=1 \
    -e CONNECT_KEY_CONVERTER=org.apache.kafka.connect.storage.StringConverter \
    -e CONNECT_VALUE_CONVERTER=org.apache.kafka.connect.json.JsonConverter -e CONNECT_VALUE_CONVERTER_SCHEMAS_ENABLE=false \
    -e CONNECT_PLUGIN_PATH=/usr/share/java,/usr/share/filestream-connectors \
    confluentinc/cp-kafka-connect:7.7.1 >/dev/null

  # amd64-only image: emulated on Apple silicon, hence the slow start.
  docker run -d --name "$(name ksql)" --network "$net" -p "$ksql_port:8088" --platform linux/amd64 \
    -e KSQL_HEAP_OPTS="-Xms256m -Xmx768m" \
    -e KSQL_BOOTSTRAP_SERVERS=kafka:29092 -e KSQL_LISTENERS=http://0.0.0.0:8088 -e KSQL_KSQL_SERVICE_ID="tg_ksql_${n}_" \
    -e KSQL_KSQL_SCHEMA_REGISTRY_URL=http://schema-registry:8081 \
    -e KSQL_KSQL_LOGGING_PROCESSING_STREAM_AUTO_CREATE=true -e KSQL_KSQL_LOGGING_PROCESSING_TOPIC_AUTO_CREATE=true \
    confluentinc/ksqldb-server:0.29.0 >/dev/null

  wait_for "http://localhost:$sr_port/subjects" "Schema Registry" "$(name sr)"
  wait_for "http://localhost:$connect_port/" "Kafka Connect" "$(name connect)"
  wait_for "http://localhost:$ksql_port/info" "ksqlDB" "$(name ksql)"
  ports
}

down() {
  docker rm -f "$(name ksql)" "$(name connect)" "$(name sr)" "$(name kafka)" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
  echo "Stack $n removed."
}

case "$action" in
  up) up ;;
  down) down ;;
  ports) ports ;;
  *) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//' && exit 1 ;;
esac
