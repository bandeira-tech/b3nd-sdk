/**
 * Schema module hot-loading for managed nodes.
 *
 * Supports dynamic import of schema modules from URLs, with cache-busting
 * for hot-reload when the schemaModuleUrl changes in config.
 */

import type { Schema } from "@bandeira-tech/b3nd-sdk";

/**
 * Dynamically import a schema module from a URL.
 * Uses a cache-busting query parameter to ensure fresh imports.
 */
export async function loadSchemaModule(url: string): Promise<Schema> {
  const cacheBustedUrl = `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
  const imported = await import(cacheBustedUrl);
  const schema: Schema = imported.default as Schema;
  if (!schema || typeof schema !== "object") {
    throw new Error(`Schema module at ${url} must export a default Schema object`);
  }
  return schema;
}

export interface ModuleWatcherOptions {
  currentUrl: string | undefined;
  intervalMs: number;
  onModuleChange: (schema: Schema, url: string) => Promise<void>;
  onError?: (error: Error) => void;
}

export interface ModuleWatcher {
  /** Update the URL being watched (e.g. after config change) */
  setUrl(url: string | undefined): void;
  start(): void;
  stop(): void;
}

/**
 * Create a watcher that detects schemaModuleUrl changes and hot-loads
 * the new schema module.
 */
export function createModuleWatcher(opts: ModuleWatcherOptions): ModuleWatcher {
  let timer: ReturnType<typeof setInterval> | null = null;
  let currentUrl = opts.currentUrl;
  let lastLoadedUrl: string | undefined;

  async function check() {
    if (!currentUrl || currentUrl === lastLoadedUrl) return;
    try {
      const schema = await loadSchemaModule(currentUrl);
      lastLoadedUrl = currentUrl;
      await opts.onModuleChange(schema, currentUrl);
    } catch (error) {
      if (opts.onError) {
        opts.onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  return {
    setUrl(url: string | undefined) {
      currentUrl = url;
    },
    start() {
      if (timer) return;
      timer = setInterval(check, opts.intervalMs);
      check();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
