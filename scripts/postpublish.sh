#!/usr/bin/env bash
# Post-publish: restore mod.ts and remove _vendor/
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Cleaning up after publish..."

# Restore mod.ts imports: ../_vendor/b3nd-X/ → ../libs/b3nd-X/
sed 's|"\.\.\/_vendor\/b3nd-|"../libs/b3nd-|g' "$ROOT_DIR/src/mod.ts" > "$ROOT_DIR/src/mod.ts.bak"
mv "$ROOT_DIR/src/mod.ts.bak" "$ROOT_DIR/src/mod.ts"

# Remove vendor directory
rm -rf "$ROOT_DIR/_vendor"

echo "Done. Workspace restored."
