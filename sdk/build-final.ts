#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-run --allow-env

/**
 * Final build script for @b3nd/sdk
 *
 * This script builds the SDK for npm publishing by:
 * 1. Transpiling TypeScript to JavaScript using Deno.emit()
 * 2. Creating proper package.json for JavaScript distribution
 * 3. Publishing JavaScript + type definitions for Node.js compatibility
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
    // Directory doesn't exist, which is fine
  }
  await ensureDir(DIST_DIR);
}

async function copySourceFiles() {
  console.log("📁 Copying TypeScript source files...");

  // Copy all TypeScript files from src to dist
  for await (const entry of Deno.readDir(SRC_DIR)) {
    if (entry.isFile && entry.name.endsWith('.ts')) {
      // Use mod.browser.ts as mod.ts for the browser distribution
      if (entry.name === 'mod.browser.ts') {
        const srcPath = join(SRC_DIR, entry.name);
        const destPath = join(DIST_DIR, 'mod.ts');
        const content = await Deno.readTextFile(srcPath);
        await Deno.writeTextFile(destPath, content);
        console.log(`  ✅ Copied ${entry.name} as mod.ts`);
      } else if (entry.name !== 'mod.ts') {
        // Copy other files, but skip the full mod.ts
        const srcPath = join(SRC_DIR, entry.name);
        const destPath = join(DIST_DIR, entry.name);

        const content = await Deno.readTextFile(srcPath);
        await Deno.writeTextFile(destPath, content);
        console.log(`  ✅ Copied ${entry.name}`);
      }
    }
  }

  // Copy clients directory
  await copyDirectory("./clients", join(DIST_DIR, "clients"));

  // Copy auth directory if it exists
  try {
    await copyDirectory("./auth", join(DIST_DIR, "auth"));
  } catch {
    console.log("  ℹ️  auth directory not found, skipping");
  }

  // Copy encrypt directory if it exists
  try {
    await copyDirectory("./encrypt", join(DIST_DIR, "encrypt"));
  } catch {
    console.log("  ℹ️  encrypt directory not found, skipping");
  }

  // Skip copying servers directory (Deno-specific, not needed for browser)
  console.log("  ℹ️  Skipping servers directory (Deno-specific)");
}

async function copyDirectory(srcDir: string, destDir: string) {
  console.log(`  📁 Copying ${srcDir}...`);

  await ensureDir(destDir);

  async function copyRecursive(src: string, dest: string) {
    for await (const entry of Deno.readDir(src)) {
      const srcPath = join(src, entry.name);
      const destPath = join(dest, entry.name);

      if (entry.isDirectory) {
        await ensureDir(destPath);
        await copyRecursive(srcPath, destPath);
      } else {
        const content = await Deno.readTextFile(srcPath);
        await Deno.writeTextFile(destPath, content);
      }
    }
  }

  await copyRecursive(srcDir, destDir);
  console.log(`    ✅ Copied ${srcDir} directory`);
}

async function copyPackageFiles() {
  console.log("📋 Copying package files...");

  const filesToCopy = [
    "README.md",
    "LICENSE"
  ];

  for (const file of filesToCopy) {
    try {
      const content = await Deno.readTextFile(file);
      await Deno.writeTextFile(join(DIST_DIR, file), content);
      console.log(`  ✅ Copied ${file}`);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        console.log(`  ⚠️  ${file} not found, skipping`);
      } else {
        throw error;
      }
    }
  }
}

async function createPackageJson() {
  console.log("📦 Creating package.json for TypeScript distribution...");

  const packageJson = JSON.parse(await Deno.readTextFile("package.json"));

  // Create a package.json optimized for TypeScript-first distribution
  const distPackageJson = {
    name: packageJson.name,
    version: packageJson.version,
    description: packageJson.description,

    // TypeScript source code (requires tsx or ts-node to run)
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

    // ES modules
    type: "module",

    files: [
      "*.ts",
      "clients/**/*.ts",
      "auth/**/*.ts",
      "encrypt/**/*.ts",
      "README.md",
      "LICENSE",
      "USAGE.md"
    ],

    keywords: packageJson.keywords,
    author: packageJson.author,
    license: packageJson.license,
    repository: packageJson.repository,
    bugs: packageJson.bugs,
    homepage: packageJson.homepage,
    engines: {
      node: ">=16.0.0"
    },
    publishConfig: {
      access: "public"
    },

    // Modern approach - let consumers handle TypeScript compilation
    // This assumes consumers have TypeScript setup
    devDependencies: {
      "typescript": "^5.0.0",
      "@types/node": "^20.0.0"
    }
  };

  await Deno.writeTextFile(
    join(DIST_DIR, "package.json"),
    JSON.stringify(distPackageJson, null, 2)
  );

  console.log("  ✅ Created package.json");
}

async function createUsageInstructions() {
  console.log("📖 Creating usage instructions...");

  const instructions = `# Usage Instructions

This package is distributed as TypeScript source code. You'll need a TypeScript runtime like [tsx](https://github.com/esbuild-kit/tsx) to use it.

## Installation

\`\`\`bash
npm install ${JSON.parse(await Deno.readTextFile("package.json")).name}
\`\`\`

## Usage

### With tsx (Recommended)

The easiest way to use this package is with [tsx](https://github.com/esbuild-kit/tsx):

\`\`\`bash
npm install --save-dev tsx
\`\`\`

Then run your code with tsx:

\`\`\`bash
tsx your-script.ts
\`\`\`

### In your code:

\`\`\`typescript
import { HttpClient } from '@bandeira-tech/b3nd-sdk';
import * as auth from '@bandeira-tech/b3nd-sdk/auth';
import * as encrypt from '@bandeira-tech/b3nd-sdk/encrypt';

// Initialize client
const client = new HttpClient({ url: 'http://localhost:8080' });

// Generate keypair
const keys = await auth.generateSigningKeyPair();

// Write encrypted data
const encrypted = await encrypt.encrypt({ data: 'secret' }, keys.publicKeyHex);

// Read and decrypt
const result = await client.read('mutable://accounts/user/data');
const decrypted = await encrypt.decrypt(result.record.data, keys.privateKey);
\`\`\`

### With ts-node

Alternatively, use [ts-node-esm](https://www.npmjs.com/package/ts-node):

\`\`\`bash
npm install --save-dev ts-node typescript @types/node
NODE_OPTIONS='--loader ts-node/esm' node your-script.ts
\`\`\`

### With TypeScript

If your project already uses TypeScript, just import directly:

\`\`\`typescript
import { HttpClient } from '@bandeira-tech/b3nd-sdk';
import * as auth from '@bandeira-tech/b3nd-sdk/auth';
import * as encrypt from '@bandeira-tech/b3nd-sdk/encrypt';
\`\`\`

## Available Clients

- \`MemoryClient\` - In-memory storage
- \`HttpClient\` - HTTP-based storage
- \`IndexedDBClient\` - Browser IndexedDB storage
- \`LocalStorageClient\` - Browser localStorage
- \`WebSocketClient\` - WebSocket-based storage

## Auth & Encryption

Import from subpaths for authentication and encryption:

\`\`\`typescript
import * as auth from '@bandeira-tech/b3nd-sdk/auth';
import * as encrypt from '@bandeira-tech/b3nd-sdk/encrypt';
\`\`\`

## Documentation

See the main README.md for detailed documentation and examples.
`;

  await Deno.writeTextFile(join(DIST_DIR, "USAGE.md"), instructions);
  console.log("  ✅ Created usage instructions");
}

async function build(options: { clean?: boolean } = {}) {
  console.log("🚀 Starting TypeScript-first build process...");

  if (options.clean) {
    await cleanDist();
  } else {
    await ensureDir(DIST_DIR);
  }

  try {
    await copySourceFiles();
    await copyPackageFiles();
    await createPackageJson();
    await createUsageInstructions();

    console.log("✅ Build completed successfully!");
    console.log(`📦 Package ready in ${DIST_DIR}/`);
    console.log("");
    console.log("This package contains TypeScript source code.");
    console.log("Consumers should use 'tsx' or 'ts-node' to run it, or add a TypeScript loader.");
    console.log("");
    console.log("Next steps:");
    console.log("  cd dist");
    console.log("  npm publish --dry-run");
    console.log("  npm publish");
  } catch (error) {
    console.error("❌ Build failed:", error.message);
    throw error;
  }
}

// CLI handling
if (import.meta.main) {
  const args = Deno.args;
  const options = {
    clean: args.includes('--clean') || !args.includes('--no-clean')
  };

  await build(options);
}

export { build };