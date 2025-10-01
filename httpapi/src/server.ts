#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-env

/**
 * HTTP API Server
 *
 * Production server entry point with enhanced logging, signal handling,
 * and client lifecycle management. For simpler usage, you can also
 * run mod.ts directly or import the app for custom setups.
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
 *   HEALTH_CHECK_INTERVAL - Health check interval in ms (default: 60000)
 */

import { app } from "./mod.ts";
import { getClientManager, type InstancesConfig } from "./clients.ts";
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
 * Load instances configuration
 */
async function loadInstancesConfig(configPath: string): Promise<InstancesConfig> {
  try {
    const content = await Deno.readTextFile(configPath);
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to load instances config from ${configPath}: ${error}`);
  }
}

/**
 * Initialize server and clients
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

  // Initialize client manager
  const instancesConfigPath =
    Deno.env.get("INSTANCES_CONFIG") || "./config/instances.json";
  const clientManager = getClientManager();

  try {
    logger.info(`Loading instances from ${instancesConfigPath}...`);
    const instancesConfig = await loadInstancesConfig(instancesConfigPath);
    await clientManager.initialize(instancesConfig);
    logger.success("Client manager initialized successfully");

    // Display loaded instances
    const instanceNames = clientManager.getInstanceNames();
    logger.info(`Loaded ${instanceNames.length} instance(s):`);
    for (const name of instanceNames) {
      const isDefault = name === clientManager.getDefaultInstance();
      logger.info(`  - ${name}${isDefault ? " (default)" : ""}`);
    }
  } catch (error) {
    logger.error("Failed to initialize client manager:", error);
    throw error;
  }

  // Create abort controller for graceful shutdown
  const abortController = new AbortController();

  // Setup signal handlers for graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, initiating graceful shutdown...`);

    try {
      // Cleanup clients
      logger.info("Cleaning up clients...");
      await clientManager.cleanup();
      logger.success("Clients cleaned up successfully");

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
    // Initialize server and clients
    const { port, signal } = await initializeServer();

    // Print banner
    printBanner(port);

    // Start health check
    startHealthCheck();

    // Start the server
    logger.info("Server is ready to accept connections");

    Deno.serve(
      {
        port,
        signal,
        onListen: ({ hostname, port }) => {
          logger.debug(`Listening on ${hostname}:${port}`);
        },
        onError: (error) => {
          logger.error("Server error:", error);
          return new Response("Internal Server Error", { status: 500 });
        },
      },
      app.fetch,
    );
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
      const clientManager = getClientManager();
      const instanceNames = clientManager.getInstanceNames();

      let allHealthy = true;
      for (const name of instanceNames) {
        try {
          const client = clientManager.getClient(name);
          const status = await client.health();
          if (status.status !== "healthy") {
            allHealthy = false;
            logger.warn(
              `Instance '${name}' is ${status.status}: ${status.message || "No details"}`,
            );
          }
        } catch (error) {
          allHealthy = false;
          logger.warn(`Instance '${name}' health check failed:`, error);
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
