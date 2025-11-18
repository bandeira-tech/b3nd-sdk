#!/usr/bin/env bash

set -euo pipefail

CONTAINER_NAME="${CONTAINER_NAME:-b3nd-postgres-test}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:17-alpine}"
POSTGRES_DB="${POSTGRES_DB:-b3nd_test}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-55432}"

cleanup() {
  echo "Stopping Postgres container '${CONTAINER_NAME}'..."
  docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
}

trap cleanup EXIT

echo "Starting Postgres container '${CONTAINER_NAME}' on port ${POSTGRES_PORT}..."
docker run --rm -d \
  --name "${CONTAINER_NAME}" \
  -e POSTGRES_DB="${POSTGRES_DB}" \
  -e POSTGRES_USER="${POSTGRES_USER}" \
  -e POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
  -p "${POSTGRES_PORT}:5432" \
  "${POSTGRES_IMAGE}"

echo "Waiting for Postgres to become ready..."
for i in $(seq 1 30); do
  if docker exec "${CONTAINER_NAME}" pg_isready -U "${POSTGRES_USER}" >/dev/null 2>&1; then
    echo "Postgres is ready."
    break
  fi
  sleep 1
done

if ! docker exec "${CONTAINER_NAME}" pg_isready -U "${POSTGRES_USER}" >/dev/null 2>&1; then
  echo "Postgres did not become ready in time."
  exit 1
fi

export POSTGRES_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT}/${POSTGRES_DB}"

echo "Running SDK Memory + Postgres client tests with POSTGRES_URL=${POSTGRES_URL}"

cd "$(dirname "$0")/sdk"

deno test -A tests/memory-client.test.ts tests/postgres-client.test.ts

