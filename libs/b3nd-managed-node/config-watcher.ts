/**
 * Config watcher for managed nodes.
 *
 * Polls the config URI at a configurable interval and invokes a callback
 * when the config changes (detected via record timestamp).
 */

import type { NodeProtocolInterface } from "@bandeira-tech/b3nd-sdk";
import { loadConfig } from "./config-loader.ts";
import type { ManagedNodeConfig } from "./types.ts";

export interface ConfigWatcherOptions {
  configClient: NodeProtocolInterface;
  operatorPubKeyHex: string;
  nodeId: string;
  intervalMs: number;
  onConfigChange: (newConfig: ManagedNodeConfig) => Promise<void>;
  onError?: (error: Error) => void;
}

export interface ConfigWatcher {
  start(): void;
  stop(): void;
}

/**
 * Create a polling config watcher that detects config changes by comparing
 * the record timestamp against the last known value.
 */
export function createConfigWatcher(opts: ConfigWatcherOptions): ConfigWatcher {
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastTimestamp = 0;
  let polling = false;

  async function poll() {
    if (polling) return;
    polling = true;
    try {
      const loaded = await loadConfig(
        opts.configClient,
        opts.operatorPubKeyHex,
        opts.nodeId,
      );

      if (loaded.timestamp > lastTimestamp) {
        lastTimestamp = loaded.timestamp;
        await opts.onConfigChange(loaded.config);
      }
    } catch (error) {
      if (opts.onError) {
        opts.onError(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      polling = false;
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(poll, opts.intervalMs);
      // Immediate first poll
      poll();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
