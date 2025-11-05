#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-run

/**
 * NPM build script for @b3nd/sdk
 * Converts Deno TypeScript to Node.js JavaScript with proper imports
 */

import { ensureDir } from "https://deno.land/std@0.208.0/fs/mod.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";

const DIST_DIR = "./dist";
const SRC_DIR = "./src";

async function cleanDist() {
  console.log("🧹 Cleaning dist directory...");
  try {
    await Deno.remove(DIST_DIR, { recursive: true });
  } catch {
    // Directory doesn't exist
  }
  await ensureDir(DIST_DIR);
}

/**
 * Replace Deno imports with Node.js equivalents
 */
function convertDenoImports(content: string): string {
  // Replace @std/encoding/hex imports
  content = content.replace(
    /import\s*{\s*([^}]*)\s*}\s*from\s*["']@std\/encoding\/hex["']/g,
    (match, imports) => {
      const items = imports.split(',').map((s: string) => s.trim()).filter((s: string) => s);
      let result = "// Encoding utilities (using Node.js Buffer)\n";

      if (items.includes('encodeHex')) {
        result += "const encodeHex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');\n";
      }
      if (items.includes('decodeHex')) {
        result += "const decodeHex = (hex: string) => new Uint8Array(Buffer.from(hex, 'hex'));\n";
      }

      return result.trimEnd();
    }
  );

  // Replace @std/encoding/base64 imports
  content = content.replace(
    /import\s*{\s*([^}]*)\s*}\s*from\s*["']@std\/encoding\/base64["']/g,
    (match, imports) => {
      const items = imports.split(',').map((s: string) => s.trim()).filter((s: string) => s);
      let result = "// Base64 encoding (using Node.js Buffer)\n";

      if (items.includes('encodeBase64')) {
        result += "const encodeBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');\n";
      }
      if (items.includes('decodeBase64')) {
        result += "const decodeBase64 = (b64: string) => new Uint8Array(Buffer.from(b64, 'base64'));\n";
      }

      return result.trimEnd();
    }
  );

  return content;
}

async function transpileFile(srcPath: string, destPath: string) {
  let content = await Deno.readTextFile(srcPath);

  // Convert Deno imports to Node.js
  content = convertDenoImports(content);

  // Write transpiled file
  await ensureDir(destPath.split("/").slice(0, -1).join("/"));
  await Deno.writeTextFile(destPath, content);
}

async function processDirectory(srcDir: string, destDir: string) {
  await ensureDir(destDir);

  async function processRecursive(src: string, dest: string) {
    for await (const entry of Deno.readDir(src)) {
      const srcPath = join(src, entry.name);
      const destPath = join(dest, entry.name);

      if (entry.isDirectory) {
        await ensureDir(destPath);
        await processRecursive(srcPath, destPath);
      } else if (entry.name.endsWith('.ts')) {
        // Convert .ts to .ts (still TypeScript, but with Node.js imports)
        await transpileFile(srcPath, destPath);
      } else if (!entry.name.startsWith('.') && !entry.name.startsWith('deno.')) {
        // Copy non-TypeScript files
        const content = await Deno.readTextFile(srcPath);
        await Deno.writeTextFile(destPath, content);
      }
    }
  }

  await processRecursive(srcDir, destDir);
}

async function build() {
  console.log("🚀 Converting SDK for Node.js...\n");

  await cleanDist();

  // Process src directory
  console.log("📝 Processing src/...");
  for await (const entry of Deno.readDir(SRC_DIR)) {
    if (entry.isFile && entry.name.endsWith('.ts')) {
      if (entry.name === 'mod.browser.ts') {
        await transpileFile(join(SRC_DIR, entry.name), join(DIST_DIR, 'mod.ts'));
        console.log(`  ✅ Converted ${entry.name}`);
      } else if (entry.name !== 'mod.ts') {
        await transpileFile(join(SRC_DIR, entry.name), join(DIST_DIR, entry.name));
        console.log(`  ✅ Converted ${entry.name}`);
      }
    }
  }

  // Process subdirectories
  console.log("📁 Processing clients/...");
  await processDirectory("./clients", join(DIST_DIR, "clients"));
  console.log("  ✅ Converted clients");

  console.log("📁 Processing auth/...");
  try {
    await processDirectory("./auth", join(DIST_DIR, "auth"));
    console.log("  ✅ Converted auth");
  } catch {
    console.log("  ⚠️  auth not found");
  }

  console.log("📁 Processing encrypt/...");
  try {
    await processDirectory("./encrypt", join(DIST_DIR, "encrypt"));
    console.log("  ✅ Converted encrypt");
  } catch {
    console.log("  ⚠️  encrypt not found");
  }

  // Copy package files
  console.log("📋 Copying package files...");
  for (const file of ["README.md", "LICENSE"]) {
    try {
      const content = await Deno.readTextFile(file);
      await Deno.writeTextFile(join(DIST_DIR, file), content);
      console.log(`  ✅ Copied ${file}`);
    } catch {
      console.log(`  ⚠️  ${file} not found`);
    }
  }

  // Update package.json
  console.log("📦 Creating package.json...");
  const packageJson = JSON.parse(await Deno.readTextFile("package.json"));
  const distPackageJson = {
    ...packageJson,
    main: "./mod.ts",
    module: "./mod.ts",
    types: "./mod.ts",
    exports: {
      ".": {
        "import": "./mod.ts",
        "require": "./mod.ts",
        "types": "./mod.ts"
      },
      "./auth": {
        "import": "./auth/mod.ts",
        "require": "./auth/mod.ts",
        "types": "./auth/mod.ts"
      },
      "./encrypt": {
        "import": "./encrypt/mod.ts",
        "require": "./encrypt/mod.ts",
        "types": "./encrypt/mod.ts"
      },
      "./clients/memory": {
        "import": "./clients/memory/mod.ts",
        "require": "./clients/memory/mod.ts",
        "types": "./clients/memory/mod.ts"
      },
      "./clients/http": {
        "import": "./clients/http/mod.ts",
        "require": "./clients/http/mod.ts",
        "types": "./clients/http/mod.ts"
      },
      "./clients/local-storage": {
        "import": "./clients/local-storage/mod.ts",
        "require": "./clients/local-storage/mod.ts",
        "types": "./clients/local-storage/mod.ts"
      }
    },
    type: "module",
    files: ["*.ts", "clients/**/*.ts", "auth/**/*.ts", "encrypt/**/*.ts", "README.md", "LICENSE"]
  };

  await Deno.writeTextFile(
    join(DIST_DIR, "package.json"),
    JSON.stringify(distPackageJson, null, 2)
  );
  console.log("  ✅ Created package.json");

  console.log("\n✅ Build completed successfully!");
  console.log(`📦 Package ready in ${DIST_DIR}/\n`);
}

await build();
