// Filesystem executor for FilesystemClient, following the same pattern as
// the Postgres and Mongo executors. Uses Deno's built-in fs APIs.
// This module is installation-specific so the core SDK stays decoupled from
// any concrete filesystem API.

import { ensureDir } from "jsr:@std/fs@1/ensure-dir";
import { walk } from "jsr:@std/fs@1/walk";
import { dirname, relative } from "jsr:@std/path@1";

import type { FsExecutor } from "@bandeira-tech/b3nd-sdk/client-fs";

export function createFsExecutor(rootDir: string): FsExecutor {
  return {
    async readFile(path: string): Promise<string> {
      return await Deno.readTextFile(path);
    },

    async writeFile(path: string, content: string): Promise<void> {
      await ensureDir(dirname(path));
      await Deno.writeTextFile(path, content);
    },

    async removeFile(path: string): Promise<void> {
      await Deno.remove(path);
    },

    async exists(path: string): Promise<boolean> {
      try {
        await Deno.stat(path);
        return true;
      } catch {
        return false;
      }
    },

    async listFiles(dir: string): Promise<string[]> {
      try {
        await Deno.stat(dir);
      } catch {
        return [];
      }

      const files: string[] = [];
      for await (
        const entry of walk(dir, { includeFiles: true, includeDirs: false })
      ) {
        files.push(relative(dir, entry.path));
      }
      return files;
    },
  };
}
