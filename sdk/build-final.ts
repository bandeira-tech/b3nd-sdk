#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-run

/**
 * Final build script for @b3nd/sdk
 *
 * This script builds the SDK for npm publishing by:
 * 1. Copying TypeScript source files
 * 2. Creating proper package.json for TypeScript distribution
 * 3. Setting up for modern TypeScript-first publishing
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

  // Skip copying servers directory (Deno-specific, not needed for browser)
  console.log("  ℹ️  Skipping servers directory (Deno-specific)");

  // Copy auth directory if it exists
  try {
    await copyDirectory("./auth", join(DIST_DIR, "auth"));
  } catch {
    console.log("  ℹ️  auth directory not found, skipping");
  }
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

    // TypeScript-first approach - point directly to TypeScript files
    main: "./mod.ts",
    module: "./mod.ts",
    types: "./mod.ts",
    exports: {
      ".": {
        "import": "./mod.ts",
        "require": "./mod.ts",
        "types": "./mod.ts"
      }
    },

    // ES modules
    type: "module",

    files: [
      "*.ts",
      "clients/**/*.ts",
      "auth/**/*.ts",
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

This package is distributed as TypeScript source code for maximum compatibility and flexibility.

## Installation

\`\`\`bash
npm install ${JSON.parse(await Deno.readTextFile("package.json")).name}
\`\`\`

## Usage

### TypeScript Projects

Simply import and use:

\`\`\`typescript
import { MemoryClient, HttpClient, IndexedDBClient } from '@b3nd/sdk';

const client = new MemoryClient({});
await client.write('key', { data: 'value' });
const result = await client.read('key');
console.log(result);
\`\`\`

### JavaScript Projects

For JavaScript projects, you'll need to set up TypeScript compilation:

1. Install TypeScript:
   \`\`\`bash
   npm install --save-dev typescript @types/node
   \`\`\`

2. Create a \`tsconfig.json\`:
   \`\`\`json
   {
     "compilerOptions": {
       "target": "ES2020",
       "module": "ESNext",
       "moduleResolution": "node",
       "allowSyntheticDefaultImports": true,
       "esModuleInterop": true
     }
   }
   \`\`\`

3. Use a build tool like \`ts-node\`, \`esbuild\`, or \`swc\` to compile.

## Available Clients

- \`MemoryClient\` - In-memory storage
- \`HttpClient\` - HTTP-based storage
- \`IndexedDBClient\` - Browser IndexedDB storage
- \`LocalStorageClient\` - Browser localStorage
- \`WebSocketClient\` - WebSocket-based storage

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
    console.log("This is a TypeScript-first package. Consumers will compile it themselves.");
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