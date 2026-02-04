import { Hono } from "hono";
import { HealthMonitor } from "../services/health-monitor.ts";

/**
 * Creates health routes with dependency injection of HealthMonitor
 */
export function healthRouter(healthMonitor: HealthMonitor): Hono {
  const app = new Hono();

  /**
   * GET /health - Get current health status of all services
   */
  app.get("/", (c) => {
    const services = healthMonitor.getHealth();

    const healthy = services.filter((s) => s.status === "healthy").length;
    const unhealthy = services.filter((s) => s.status === "unhealthy").length;
    const unknown = services.filter((s) => s.status === "unknown").length;

    return c.json({
      status: unhealthy === 0 ? "healthy" : "degraded",
      summary: {
        healthy,
        unhealthy,
        unknown,
        total: services.length,
      },
      services,
      timestamp: Date.now(),
    });
  });

  /**
   * GET /health/:id - Get health status of a specific service
   */
  app.get("/:id", (c) => {
    const id = c.req.param("id");
    const health = healthMonitor.getServiceHealth(id);

    if (!health) {
      return c.json({ error: "Service not found" }, 404);
    }

    return c.json(health);
  });

  /**
   * POST /health/check - Force an immediate health check
   */
  app.post("/check", async (c) => {
    const services = await healthMonitor.forceCheck();

    return c.json({
      status: "checked",
      services,
      timestamp: Date.now(),
    });
  });

  /**
   * POST /health/services - Add a service to monitor
   */
  app.post("/services", async (c) => {
    try {
      const body = await c.req.json();

      if (!body.id || !body.name || !body.url) {
        return c.json(
          { error: "Missing required fields: id, name, url" },
          400,
        );
      }

      healthMonitor.addService({
        id: body.id,
        name: body.name,
        url: body.url,
        healthEndpoint: body.healthEndpoint,
      });

      return c.json({
        status: "added",
        service: {
          id: body.id,
          name: body.name,
          url: body.url,
        },
      });
    } catch (e) {
      return c.json({ error: "Invalid request body" }, 400);
    }
  });

  /**
   * DELETE /health/services/:id - Remove a service from monitoring
   */
  app.delete("/services/:id", (c) => {
    const id = c.req.param("id");
    const health = healthMonitor.getServiceHealth(id);

    if (!health) {
      return c.json({ error: "Service not found" }, 404);
    }

    healthMonitor.removeService(id);

    return c.json({
      status: "removed",
      id,
    });
  });

  return app;
}
