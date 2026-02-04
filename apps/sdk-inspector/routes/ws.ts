import { Hono } from "hono";
import { WsHub } from "../services/ws-hub.ts";

/**
 * Creates WebSocket routes with dependency injection of WsHub
 */
export function wsRouter(wsHub: WsHub): Hono {
  const app = new Hono();

  /**
   * WebSocket upgrade endpoint
   */
  app.get("/", (c) => {
    // Check if this is a WebSocket upgrade request
    const upgradeHeader = c.req.header("Upgrade");

    if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
      return c.json(
        {
          error: "WebSocket upgrade required",
          hint: "Connect using a WebSocket client",
        },
        400
      );
    }

    // Use Deno's upgradeWebSocket
    const { socket, response } = Deno.upgradeWebSocket(c.req.raw);

    socket.onopen = () => {
      wsHub.addClient(socket);

      // Send initial connection message
      socket.send(
        JSON.stringify({
          type: "connected",
          timestamp: Date.now(),
          clientCount: wsHub.getClientCount(),
        })
      );
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleClientMessage(socket, message, wsHub);
      } catch (e) {
        console.error("[WsRouter] Invalid message:", e);
        socket.send(
          JSON.stringify({
            type: "error",
            error: "Invalid JSON message",
          })
        );
      }
    };

    socket.onerror = (e) => {
      console.error("[WsRouter] WebSocket error:", e);
    };

    socket.onclose = () => {
      // Client removal is handled in WsHub.addClient
    };

    return response;
  });

  /**
   * GET /ws/status - Get WebSocket hub status
   */
  app.get("/status", (c) => {
    return c.json({
      clientCount: wsHub.getClientCount(),
      timestamp: Date.now(),
    });
  });

  return app;
}

/**
 * Handle messages from WebSocket clients
 */
function handleClientMessage(
  socket: WebSocket,
  message: { type: string; [key: string]: unknown },
  wsHub: WsHub
): void {
  switch (message.type) {
    case "ping":
      socket.send(
        JSON.stringify({
          type: "pong",
          timestamp: Date.now(),
        })
      );
      break;

    case "subscribe":
      // Future: implement topic subscriptions
      socket.send(
        JSON.stringify({
          type: "subscribed",
          topics: message.topics || ["all"],
          timestamp: Date.now(),
        })
      );
      break;

    default:
      console.log("[WsRouter] Unknown message type:", message.type);
  }
}
