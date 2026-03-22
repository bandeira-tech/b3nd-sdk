import { assertThrows } from "@std/assert";
import { websocketServer } from "./websocket.ts";

// ============================================================================
// websocketServer - placeholder validation
// ============================================================================

Deno.test("websocketServer - returns ServerFrontend shape", () => {
  const ws = websocketServer();
  // Should have the three methods of ServerFrontend
  if (typeof ws.listen !== "function") throw new Error("listen missing");
  if (typeof ws.fetch !== "function") throw new Error("fetch missing");
  if (typeof ws.configure !== "function") throw new Error("configure missing");
});

Deno.test("websocketServer - listen throws not implemented", () => {
  const ws = websocketServer();
  assertThrows(
    () => ws.listen(8080),
    Error,
    "websocketServer.listen not implemented",
  );
});

Deno.test("websocketServer - fetch throws not implemented", () => {
  const ws = websocketServer();
  assertThrows(
    () => ws.fetch(new Request("http://localhost")),
    Error,
    "websocketServer.fetch not implemented",
  );
});

Deno.test("websocketServer - configure does not throw (no-op)", () => {
  const ws = websocketServer();
  // configure is a no-op, should not throw
  ws.configure({} as unknown as Parameters<typeof ws.configure>[0]);
});
