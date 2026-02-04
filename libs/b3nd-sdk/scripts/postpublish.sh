#!/usr/bin/env bash
# Post-publish: restore mod.ts and remove _vendor/
set -euo pipefail

SDK_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Cleaning up after publish..."

# Restore mod.ts imports: ../_vendor/b3nd-X/ → ../../b3nd-X/
sed 's|"\.\.\/_vendor\/b3nd-|"../../b3nd-|g' "$SDK_DIR/src/mod.ts" > "$SDK_DIR/src/mod.ts.bak"
mv "$SDK_DIR/src/mod.ts.bak" "$SDK_DIR/src/mod.ts"

# Remove vendor directory
rm -rf "$SDK_DIR/_vendor"

echo "Done. Workspace restored."
