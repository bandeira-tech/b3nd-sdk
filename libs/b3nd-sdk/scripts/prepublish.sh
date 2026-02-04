#!/usr/bin/env bash
# Pre-publish: vendor sibling lib source into _vendor/ for JSR publishing
set -euo pipefail

SDK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$SDK_DIR/_vendor"

echo "Vendoring source files for JSR publish..."

# Clean previous vendor
rm -rf "$VENDOR"

# Copy needed source (excluding tests, node_modules, dist)
for lib in b3nd-core b3nd-compose b3nd-blob b3nd-msg b3nd-servers \
           b3nd-client-memory b3nd-client-http b3nd-client-ws \
           b3nd-client-postgres b3nd-client-mongo \
           b3nd-combinators b3nd-encrypt b3nd-auth; do
  src="$SDK_DIR/../$lib"
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

# Rewrite mod.ts imports: ../../b3nd-X/ → ../_vendor/b3nd-X/
# (mod.ts is in src/, _vendor/ is at SDK root)
sed -i '' 's|"\.\./\.\./b3nd-|"../_vendor/b3nd-|g' "$SDK_DIR/src/mod.ts"

echo "Vendored $(find "$VENDOR" -name '*.ts' | wc -l | tr -d ' ') files into _vendor/"
echo "Ready to publish. Run: cd $SDK_DIR && deno publish"
