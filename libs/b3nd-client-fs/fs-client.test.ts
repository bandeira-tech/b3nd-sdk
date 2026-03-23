/**
 * FilesystemClient Tests
 *
 * Tests the filesystem client implementation using the shared test suite.
 * Uses Deno's built-in filesystem APIs with temporary directories.
 */

/// <reference lib="deno.ns" />

import { FilesystemClient, type FsExecutor } from "./mod.ts";
import { runSharedSuite } from "../b3nd-testing/shared-suite.ts";
import { runNodeSuite } from "../b3nd-testing/node-suite.ts";
import type { PersistenceRecord, Schema } from "../b3nd-core/types.ts";
import { join } from "jsr:@std/path@1";

/**
 * Deno-based FsExecutor using Deno.readTextFile / Deno.writeTextFile.
 */
class DenoFsExecutor implements FsExecutor {
  async readFile(path: string): Promise<string> {
    return await Deno.readTextFile(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    // Ensure parent directory exists
    const dir = path.substring(0, path.lastIndexOf("/"));
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(path, content);
  }

  async removeFile(path: string): Promise<void> {
    await Deno.remove(path);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await Deno.stat(path);
      return true;
    } catch {
      return false;
    }
  }

  async listFiles(dir: string): Promise<string[]> {
    try {
      await Deno.stat(dir);
    } catch {
      return [];
    }

    const files: string[] = [];
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isFile) {
        files.push(entry.name);
      } else if (entry.isDirectory) {
        const subFiles = await this.listFilesRecursive(join(dir, entry.name), entry.name);
        files.push(...subFiles);
      }
    }
    return files;
  }

  private async listFilesRecursive(dir: string, prefix: string): Promise<string[]> {
    const files: string[] = [];
    for await (const entry of Deno.readDir(dir)) {
      const relPath = `${prefix}/${entry.name}`;
      if (entry.isFile) {
        files.push(relPath);
      } else if (entry.isDirectory) {
        const subFiles = await this.listFilesRecursive(join(dir, entry.name), relPath);
        files.push(...subFiles);
      }
    }
    return files;
  }

  async cleanup(): Promise<void> {
    // No-op — cleanup handled by temp dir removal
  }
}

function createSchema(
  validator?: (value: unknown) => Promise<{ valid: boolean; error?: string }>,
): Schema {
  const defaultValidator = async (
    { value, read }: { value: unknown; read: unknown },
  ) => {
    if (validator) {
      return validator(value);
    }
    const _ = read as <T = unknown>(
      uri: string,
    ) => Promise<{ success: boolean; record?: PersistenceRecord<T> }>;
    return { valid: true };
  };

  return {
    "store://users": defaultValidator,
    "store://files": defaultValidator,
    "store://pagination": defaultValidator,
  };
}

async function createClient(schema: Schema): Promise<FilesystemClient> {
  const tmpDir = await Deno.makeTempDir({ prefix: "b3nd_fs_test_" });
  const executor = new DenoFsExecutor();
  return new FilesystemClient(
    {
      rootDir: tmpDir,
      schema,
    },
    executor,
  );
}

runSharedSuite("FilesystemClient", {
  happy: () => createClient(createSchema()),

  validationError: () =>
    createClient(
      createSchema(async (value) => {
        const data = value as { name?: string };
        if (!data.name) {
          return { valid: false, error: "Name is required" };
        }
        return { valid: true };
      }),
    ),
});

runNodeSuite("FilesystemClient", {
  happy: () => createClient(createSchema()),

  validationError: () =>
    createClient(
      createSchema(async (value) => {
        const data = value as { name?: string };
        if (!data.name) {
          return { valid: false, error: "Name is required" };
        }
        return { valid: true };
      }),
    ),
});
