#!/bin/bash
set -e
echo "Starting test databases..."
docker compose -f docker-compose.test.yml up -d --wait
echo "Test databases ready!"
