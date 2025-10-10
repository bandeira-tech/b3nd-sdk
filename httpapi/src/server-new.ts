/**
 * New HTTP API Server with Programmatic Client Setup
 *
 * This version allows developers to create and register clients programmatically
 * instead of using static JSON configuration.
 *
 * Usage:
 *   // Create your own clients
 *   const memoryClient = new MemoryClient({ schema: mySchema });
 *   const httpClient = new HttpClient({ url: "https://api.example.com" });
 *
 *   // Register them
 *   const manager = getClientManager();
 *   manager.registerClient("local", memoryClient, true); // default
 *   manager.registerClient("remote", httpClient);
 *
 *   // Start server
 *   await startServer();
 */

import { app } from "./mod.ts";
import { getClientManager, type ClientManagerConfig } from "./clients.ts";
import { loadServerConfig } from "./config.ts";

// Re-export the logger - but don't redeclare it, just use the same implementation

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
export class Logger {
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
 * Initialize server with programmatic client setup
 * Clients should be registered before calling this function
 */
async function initializeServer(programmaticClients?: ClientManagerConfig): Promise<{
  port: number;
  signal: AbortSignal;
}> {
  logger.info("Initializing server...");

  // Load server configuration
  const serverConfigPath = Deno.env.get("SERVER_CONFIG") || "./config/server.json";
  let serverConfig;

  try {
    serverConfig = await loadServerConfig(serverConfigPath);
    logger.success(`Server configuration loaded from ${serverConfigPath}`);
  } catch (error) {
    logger.warn(`Failed to load server config from ${serverConfigPath}, using defaults`);
    logger.debug(error);
    serverConfig = {
      port: parseInt(Deno.env.get("API_PORT") || "8000"),
      cors: {
        origin: ["*"],
        credentials: false,
        methods: ["GET", "POST", "DELETE", "OPTIONS"],
        headers: ["Content-Type", "Authorization"],
      },
    };
  }

  // Initialize client manager
  const clientManager = getClientManager();

  if (programmaticClients) {
    // Use programmatically provided clients
    logger.info("Initializing with programmatic client configuration...");
    await clientManager.initialize(programmaticClients);
    logger.success("Client manager initialized with programmatic clients");
  } else {
    // Check if clients are already registered
    const existingClients = clientManager.getInstanceNames();
    if (existingClients.length === 0) {
      logger.warn("No clients registered! Clients should be registered before starting the server.");
      logger.info("Example: getClientManager().registerClient('default', new MemoryClient());");
    }
  }

  // Display loaded instances
  const instanceNames = clientManager.getInstanceNames();
  if (instanceNames.length > 0) {
    logger.info(`Registered ${instanceNames.length} instance(s):`);
    for (const name of instanceNames) {
      const isDefault = name === clientManager.getDefaultInstance();
      logger.info(`  - ${name}${isDefault ? " (default)" : ""}`);
    }
  } else {
    logger.warn("No client instances registered!");
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
 * Start the server with programmatic client setup
 */
export async function startServer(programmaticClients?: ClientManagerConfig): Promise<void> {
  try {
    // Initialize server and clients
    const { port, signal } = await initializeServer(programmaticClients);

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
 * Alternative: Start server with a client setup function
 */
export async function startServerWithSetup(setupFn: () => Promise<void> | void): Promise<void> {
  // Run the setup function to register clients
  await setupFn();

  // Start the server with registered clients
  await startServer();
}

/**
 * Main entry point for direct execution
 */
if (import.meta.main) {
  startServer().catch((error) => {
    logger.error("Fatal error:", error);
    Deno.exit(1);
  });
}