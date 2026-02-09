/// <reference lib="deno.ns" />
export interface ServiceHealth {
  id: string;
  name: string;
  url: string;
  status: "healthy" | "unhealthy" | "unknown";
  latency?: number;
  lastChecked: number;
  error?: string;
}

export interface HealthConfig {
  services: Array<{
    id: string;
    name: string;
    url: string;
    healthEndpoint?: string;
  }>;
  pollInterval: number;
}

const DEFAULT_CONFIG: HealthConfig = {
  services: [
    {
      id: "http-server",
      name: "HTTP API Server",
      url: "http://localhost:9942",
      healthEndpoint: "/api/v1/health",
    },
    {
      id: "wallet-server",
      name: "Wallet Server (optional)",
      url: "http://localhost:9943",
      healthEndpoint: "/api/v1/health",
    },
    {
      id: "app-server",
      name: "App Server (optional)",
      url: "http://localhost:9944",
      healthEndpoint: "/api/v1/health",
    },
  ],
  pollInterval: 10000, // 10 seconds
};

/**
 * Monitors health of B3nd services and broadcasts status updates
 */
export class HealthMonitor {
  private config: HealthConfig;
  private healthState: Map<string, ServiceHealth> = new Map();
  private pollTimer: number | null = null;
  private isRunning = false;

  constructor(config: HealthConfig = DEFAULT_CONFIG) {
    this.config = config;

    // Initialize health state
    for (const service of this.config.services) {
      this.healthState.set(service.id, {
        id: service.id,
        name: service.name,
        url: service.url,
        status: "unknown",
        lastChecked: 0,
      });
    }
  }

  /**
   * Start health monitoring
   */
  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    console.log("[HealthMonitor] Starting health monitor...");
    console.log(
      "[HealthMonitor] Monitoring services:",
      this.config.services.map((s) => s.name).join(", "),
    );

    // Initial check
    this.checkAll();

    // Set up polling
    this.pollTimer = setInterval(() => {
      this.checkAll();
    }, this.config.pollInterval);
  }

  /**
   * Stop health monitoring
   */
  stop(): void {
    if (!this.isRunning) return;

    console.log("[HealthMonitor] Stopping health monitor...");
    this.isRunning = false;

    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Check health of all services
   */
  async checkAll(): Promise<void> {
    const checks = this.config.services.map((service) =>
      this.checkService(service)
    );
    await Promise.all(checks);
  }

  /**
   * Check health of a single service
   */
  private async checkService(service: {
    id: string;
    name: string;
    url: string;
    healthEndpoint?: string;
  }): Promise<void> {
    const endpoint = service.healthEndpoint || "/health";
    const url = `${service.url}${endpoint}`;

    const startTime = Date.now();
    let status: ServiceHealth["status"] = "unknown";
    let latency: number | undefined;
    let error: string | undefined;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
      });

      clearTimeout(timeout);
      latency = Date.now() - startTime;

      if (response.ok) {
        status = "healthy";
      } else {
        status = "unhealthy";
        error = `HTTP ${response.status}`;
      }
    } catch (e) {
      latency = Date.now() - startTime;
      status = "unhealthy";
      error = e instanceof Error ? e.message : String(e);

      // Distinguish between connection errors and timeouts
      if (error.includes("abort")) {
        error = "Timeout (5s)";
      } else if (error.includes("Connection refused")) {
        error = "Connection refused";
      }
    }

    const health: ServiceHealth = {
      id: service.id,
      name: service.name,
      url: service.url,
      status,
      latency,
      lastChecked: Date.now(),
      error,
    };

    const previous = this.healthState.get(service.id);
    this.healthState.set(service.id, health);

    // Log status changes
    if (previous && previous.status !== status) {
      console.log(
        `[HealthMonitor] ${service.name}: ${previous.status} -> ${status}${
          error ? ` (${error})` : ""
        }`,
      );
    }
  }


  /**
   * Get current health state
   */
  getHealth(): ServiceHealth[] {
    return Array.from(this.healthState.values());
  }

  /**
   * Get health of a specific service
   */
  getServiceHealth(id: string): ServiceHealth | undefined {
    return this.healthState.get(id);
  }

  /**
   * Force an immediate health check
   */
  async forceCheck(): Promise<ServiceHealth[]> {
    await this.checkAll();
    return this.getHealth();
  }

  /**
   * Add a service to monitor
   */
  addService(service: {
    id: string;
    name: string;
    url: string;
    healthEndpoint?: string;
  }): void {
    this.config.services.push(service);
    this.healthState.set(service.id, {
      id: service.id,
      name: service.name,
      url: service.url,
      status: "unknown",
      lastChecked: 0,
    });
  }

  /**
   * Remove a service from monitoring
   */
  removeService(id: string): void {
    this.config.services = this.config.services.filter((s) => s.id !== id);
    this.healthState.delete(id);
  }
}
