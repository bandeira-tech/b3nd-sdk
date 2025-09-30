#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-env

/**
 * HTTP API Server
 *
 * Main entry point for the HTTP API server with persistence adapters.
 * This server provides a RESTful API for reading and writing data
 * using configurable persistence adapters.
 *
 * Usage:
 *   deno task start
 *   deno run --allow-net --allow-read --allow-write --allow-env src/server.ts
 *
 * Environment Variables:
 *   API_PORT - Port to listen on (default: 8000)
 *   INSTANCES_CONFIG - Path to instances configuration (default: ./config/instances.json)
 *   SERVER_CONFIG - Path to server configuration (default: ./config/server.json)
 *   LOG_LEVEL - Logging level: debug, info, warn, error (default: info)
 */

import { app } from "./mod.ts";
import { AdapterManager } from "./adapters/manager.ts";
import { loadServerConfig } from "./config.ts";

// Color codes for console output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

/**
 * Logger utility
 */
class Logger {
  private level: string;

  constructor(level = "info") {
    this.level = level.toLowerCase();
  }

  private shouldLog(messageLevel: string): boolean {
    const levels = ["debug", "info", "warn", "error"];
    const currentIndex = levels.indexOf(this.level);
    const messageIndex = levels.indexOf(messageLevel);
    return messageIndex >= currentIndex;
  }

  debug(...args: unknown[]): void {
    if (this.shouldLog("debug")) {
      console.log(`${colors.dim}[DEBUG]${colors.reset}`, ...args);
    }
  }

  info(...args: unknown[]): void {
    if (this.shouldLog("info")) {
      console.log(`${colors.blue}[INFO]${colors.reset}`, ...args);
    }
  }

  warn(...args: unknown[]): void {
    if (this.shouldLog("warn")) {
      console.warn(`${colors.yellow}[WARN]${colors.reset}`, ...args);
    }
  }

  error(...args: unknown[]): void {
    if (this.shouldLog("error")) {
      console.error(`${colors.red}[ERROR]${colors.reset}`, ...args);
    }
  }

  success(...args: unknown[]): void {
    if (this.shouldLog("info")) {
      console.log(`${colors.green}[SUCCESS]${colors.reset}`, ...args);
    }
  }
}

const logger = new Logger(Deno.env.get("LOG_LEVEL") || "info");

/**
 * Print server banner
 */
function printBanner(port: number): void {
  console.log(`
${colors.cyan}${colors.bright}
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║                     B3ND HTTP API Server                  ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
${colors.reset}

${colors.green}✓${colors.reset} Server starting on port ${colors.bright}${port}${colors.reset}
${colors.green}✓${colors.reset} API endpoint: ${colors.bright}http://localhost:${port}/api/v1${colors.reset}
${colors.green}✓${colors.reset} Health check: ${colors.bright}http://localhost:${port}/api/v1/health${colors.reset}
`);
}

/**
 * Initialize server and adapters
 */
async function initializeServer(): Promise<{
  port: number;
  signal: AbortSignal;
}> {
  logger.info("Initializing server...");

  // Load server configuration
  const serverConfigPath =
    Deno.env.get("SERVER_CONFIG") || "./config/server.json";
  let serverConfig;

  try {
    serverConfig = await loadServerConfig(serverConfigPath);
    logger.success(`Server configuration loaded from ${serverConfigPath}`);
  } catch (error) {
    logger.warn(
      `Failed to load server config from ${serverConfigPath}, using defaults`,
    );
    logger.debug(error);
    serverConfig = {
      port: parseInt(Deno.env.get("API_PORT") || "8000"),
      cors: {
        origins: ["*"],
        credentials: false,
        methods: ["GET", "POST", "DELETE", "OPTIONS"],
        headers: ["Content-Type", "Authorization"],
      },
    };
  }

  // Initialize adapter manager
  const instancesConfigPath =
    Deno.env.get("INSTANCES_CONFIG") || "./config/instances.json";
  const adapterManager = AdapterManager.getInstance();

  try {
    logger.info(`Loading instances from ${instancesConfigPath}...`);
    await adapterManager.initialize(instancesConfigPath);
    logger.success("Adapter manager initialized successfully");

    // Get and display loaded instances
    const adapters = adapterManager.getAllAdapters();
    logger.info(`Loaded ${adapters.size} instance(s):`);
    for (const [id, _] of adapters) {
      const isDefault = id === adapterManager.getDefaultInstanceId();
      logger.info(`  - ${id}${isDefault ? " (default)" : ""}`);
    }
  } catch (error) {
    logger.error("Failed to initialize adapter manager:", error);
    throw error;
  }

  // Create abort controller for graceful shutdown
  const abortController = new AbortController();

  // Setup signal handlers for graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, initiating graceful shutdown...`);

    try {
      // Cleanup adapters
      logger.info("Cleaning up adapters...");
      await adapterManager.cleanup();
      logger.success("Adapters cleaned up successfully");

      // Abort the server
      abortController.abort();

      // Give server time to close connections
      setTimeout(() => {
        logger.info("Shutdown complete");
        Deno.exit(0);
      }, 1000);
    } catch (error) {
      logger.error("Error during shutdown:", error);
      Deno.exit(1);
    }
  };

  // Register signal handlers
  if (Deno.build.os !== "windows") {
    Deno.addSignalListener("SIGINT", () => shutdown("SIGINT"));
    Deno.addSignalListener("SIGTERM", () => shutdown("SIGTERM"));
  }

  return {
    port: serverConfig.port,
    signal: abortController.signal,
  };
}

/**
 * Start the server
 */
async function startServer(): Promise<void> {
  try {
    // Initialize server and adapters
    const { port, signal } = await initializeServer();

    // Print banner
    printBanner(port);

    // Start health check
    startHealthCheck();

    // Start the server
    logger.info("Server is ready to accept connections");

    await Deno.serve(app.fetch, {
      port,
      signal,
      onListen: ({ hostname, port }) => {
        logger.debug(`Listening on ${hostname}:${port}`);
      },
      onError: (error) => {
        logger.error("Server error:", error);
        return new Response("Internal Server Error", { status: 500 });
      },
    });
  } catch (error) {
    logger.error("Failed to start server:", error);
    Deno.exit(1);
  }
}

/**
 * Start periodic health check
 */
function startHealthCheck(): void {
  const interval = parseInt(Deno.env.get("HEALTH_CHECK_INTERVAL") || "60000");

  if (interval <= 0) {
    logger.debug("Health check disabled");
    return;
  }

  setInterval(async () => {
    try {
      const adapterManager = AdapterManager.getInstance();
      const health = await adapterManager.checkHealth();

      let allHealthy = true;
      for (const [id, status] of health) {
        if (status.status !== "healthy") {
          allHealthy = false;
          logger.warn(
            `Instance '${id}' is ${status.status}: ${status.message || "No details"}`,
          );
        }
      }

      if (allHealthy) {
        logger.debug("All instances healthy");
      }
    } catch (error) {
      logger.error("Health check failed:", error);
    }
  }, interval);

  logger.info(`Health check enabled (interval: ${interval}ms)`);
}

/**
 * Main entry point
 */
if (import.meta.main) {
  startServer().catch((error) => {
    logger.error("Fatal error:", error);
    Deno.exit(1);
  });
}

export { startServer, Logger };
