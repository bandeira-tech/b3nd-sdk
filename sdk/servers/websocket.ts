import type { ServerFrontend } from "./node.ts";

export function websocketServer(): ServerFrontend {
  return {
    listen(_port: number) {
      // Placeholder – integrating WebSocket routing is out of current scope
      throw new Error('websocketServer.listen not implemented');
    },
  };
}

