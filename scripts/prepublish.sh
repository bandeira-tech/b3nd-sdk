#!/usr/bin/env bash
# Pre-publish: vendor sibling lib source into _vendor/ for JSR publishing
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT_DIR/_vendor"

echo "Vendoring source files for JSR publish..."

# Clean previous vendor
rm -rf "$VENDOR"

# Copy needed source (excluding tests, node_modules, dist)
for lib in b3nd-core b3nd-compose b3nd-hash b3nd-msg b3nd-servers \
           b3nd-client-memory b3nd-client-http b3nd-client-ws \
           b3nd-client-postgres b3nd-client-mongo \
           b3nd-combinators b3nd-encrypt b3nd-auth; do
  src="$ROOT_DIR/libs/$lib"
  dest="$VENDOR/$lib"
  mkdir -p "$dest"
  # Copy .ts files (not tests) and preserve subdirectory structure
  (cd "$src" && find . -name '*.ts' ! -name '*.test.ts' ! -path '*/node_modules/*' ! -path '*/dist/*') | while read -r f; do
    mkdir -p "$dest/$(dirname "$f")"
    cp "$src/$f" "$dest/$f"
  done
done

# No need to rewrite vendored file imports — ../b3nd-X/ paths are already
# correct since _vendor/ preserves the sibling directory structure.

# Rewrite mod.ts imports: ../libs/b3nd-X/ → ../_vendor/b3nd-X/
# (mod.ts is in src/, _vendor/ is at root)
sed -i '' 's|"\.\./libs/b3nd-|"../_vendor/b3nd-|g' "$ROOT_DIR/src/mod.ts"

echo "Vendored $(find "$VENDOR" -name '*.ts' | wc -l | tr -d ' ') files into _vendor/"
echo "Ready to publish. Run: cd $ROOT_DIR && deno publish"
