/// <reference lib="deno.ns" />
import { WsHub } from "./ws-hub.ts";
import { debounce } from "@std/async/debounce";

export interface FileChangeEvent {
  kind: "create" | "modify" | "remove" | "access" | "any" | "other";
  paths: string[];
}

/**
 * Watches for file changes in SDK source and test directories
 * Broadcasts changes via WebSocket for hot reload functionality
 */
export class FileWatcher {
  private wsHub: WsHub;
  private watcher: Deno.FsWatcher | null = null;
  private isRunning = false;
  private watchPaths: string[];
  private debouncedBroadcast: (changes: FileChangeEvent) => void;

  // Callback for when files change - set by owner to trigger test re-runs
  onFilesChanged?: (files: string[]) => Promise<void>;

  constructor(wsHub: WsHub) {
    this.wsHub = wsHub;

    // Determine paths relative to dashboard location (apps/sdk-inspector/services -> b3nd root)
    // Watch the entire libs directory (all b3nd-* packages)
    const dashboardDir = new URL(".", import.meta.url).pathname;
    this.watchPaths = [
      new URL("../../../libs", `file://${dashboardDir}`).pathname,
    ];

    // Debounce broadcasts to avoid flooding on rapid changes (e.g., save-all)
    this.debouncedBroadcast = debounce((changes: FileChangeEvent) => {
      this.broadcast(changes);
    }, 500);
  }

  /**
   * Start watching for file changes
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;
    console.log("[FileWatcher] Starting file watcher...");
    console.log("[FileWatcher] Watching paths:", this.watchPaths);

    // Filter to existing paths
    const existingPaths = [];
    for (const path of this.watchPaths) {
      try {
        await Deno.stat(path);
        existingPaths.push(path);
      } catch {
        console.warn(`[FileWatcher] Path does not exist, skipping: ${path}`);
      }
    }

    if (existingPaths.length === 0) {
      console.warn("[FileWatcher] No valid paths to watch");
      return;
    }

    try {
      this.watcher = Deno.watchFs(existingPaths, { recursive: true });

      // Process events in background
      this.processEvents();
    } catch (e) {
      console.error("[FileWatcher] Failed to start watcher:", e);
      this.isRunning = false;
    }
  }

  /**
   * Process file system events
   */
  private async processEvents(): Promise<void> {
    if (!this.watcher) return;

    try {
      for await (const event of this.watcher) {
        if (!this.isRunning) break;

        // Filter to TypeScript files
        const tsPaths = event.paths.filter(
          (p) => p.endsWith(".ts") || p.endsWith(".tsx"),
        );

        if (tsPaths.length === 0) continue;

        // Map Deno's event kind to our simplified version
        const kind = this.mapEventKind(event.kind);

        this.debouncedBroadcast({
          kind,
          paths: tsPaths,
        });
      }
    } catch (e) {
      if (this.isRunning) {
        console.error("[FileWatcher] Watcher error:", e);
      }
    }
  }

  /**
   * Map Deno's event kind to our simplified version
   */
  private mapEventKind(
    kind: Deno.FsEvent["kind"],
  ): FileChangeEvent["kind"] {
    switch (kind) {
      case "create":
        return "create";
      case "modify":
        return "modify";
      case "remove":
        return "remove";
      case "access":
        return "access";
      case "any":
        return "any";
      default:
        return "other";
    }
  }

  /**
   * Broadcast file changes to WebSocket clients and trigger callback
   */
  private broadcast(changes: FileChangeEvent): void {
    // Extract relative paths for cleaner output
    const relativePaths = changes.paths.map((p) => {
      const libsIdx = p.indexOf("/libs/");
      return libsIdx >= 0 ? p.slice(libsIdx) : p;
    });

    console.log(
      `[FileWatcher] ${changes.kind}: ${relativePaths.join(", ")}`,
    );

    this.wsHub.broadcast({
      type: "file:change",
      kind: changes.kind,
      files: relativePaths,
      timestamp: Date.now(),
    });

    // Trigger callback with full paths for test runner
    if (this.onFilesChanged) {
      this.onFilesChanged(changes.paths).catch((e) => {
        console.error("[FileWatcher] onFilesChanged callback error:", e);
      });
    }
  }

  /**
   * Stop watching for file changes
   */
  stop(): void {
    if (!this.isRunning) return;

    console.log("[FileWatcher] Stopping file watcher...");
    this.isRunning = false;

    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {
        // Ignore close errors
      }
      this.watcher = null;
    }
  }

  /**
   * Check if watcher is running
   */
  isActive(): boolean {
    return this.isRunning;
  }
}
