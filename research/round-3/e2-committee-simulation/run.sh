#!/bin/bash
# E2: Committee Simulation Runner
# Runs the simulation and generates the report.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_FILE="${SCRIPT_DIR}/results.jsonl"

echo "=== E2: Stake-Weighted Committee Simulation ==="
echo "Running simulation (this may take a few minutes)..."
echo ""

# Run simulation, output JSONL
deno run --allow-read --allow-write "${SCRIPT_DIR}/simulation.ts" > "${OUTPUT_FILE}"

LINES=$(wc -l < "${OUTPUT_FILE}")
echo "Simulation complete. ${LINES} configurations written to results.jsonl"
echo ""
echo "Results saved to: ${OUTPUT_FILE}"
