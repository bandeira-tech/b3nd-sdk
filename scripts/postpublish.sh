#!/usr/bin/env bash
# Post-publish: restore mod.ts and remove _vendor/
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Cleaning up after publish..."

# Restore all src/*.ts imports: ../_vendor/b3nd-X/ → ../libs/b3nd-X/
for f in "$ROOT_DIR"/src/*.ts; do
  sed 's|"\.\.\/_vendor\/b3nd-|"../libs/b3nd-|g' "$f" > "$f.bak"
  mv "$f.bak" "$f"
done

# Remove vendor directory
rm -rf "$ROOT_DIR/_vendor"

echo "Done. Workspace restored."
