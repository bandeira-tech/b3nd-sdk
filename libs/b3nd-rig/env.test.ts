import { assertEquals, assertThrows } from "@std/assert";
import { loadConfigFromEnv } from "./env.ts";

Deno.test("loadConfigFromEnv - single backend URL", () => {
  const config = loadConfigFromEnv({
    getEnv: (key) => {
      if (key === "BACKEND_URL") return "https://node.b3nd.net";
      return undefined;
    },
  });
  assertEquals(config.use, "https://node.b3nd.net");
  assertEquals(config.identitySeed, undefined);
});

Deno.test("loadConfigFromEnv - multi-backend (comma-separated)", () => {
  const config = loadConfigFromEnv({
    getEnv: (key) => {
      if (key === "BACKEND_URL") {
        return "https://node1.b3nd.net, https://node2.b3nd.net";
      }
      return undefined;
    },
  });
  assertEquals(config.use, [
    "https://node1.b3nd.net",
    "https://node2.b3nd.net",
  ]);
});

Deno.test("loadConfigFromEnv - with identity seed", () => {
  const config = loadConfigFromEnv({
    getEnv: (key) => {
      if (key === "BACKEND_URL") return "memory://";
      if (key === "IDENTITY_SEED") return "my-secret-seed";
      return undefined;
    },
  });
  assertEquals(config.use, "memory://");
  assertEquals(config.identitySeed, "my-secret-seed");
});

Deno.test("loadConfigFromEnv - throws when BACKEND_URL missing", () => {
  assertThrows(
    () =>
      loadConfigFromEnv({
        getEnv: () => undefined,
      }),
    Error,
    "BACKEND_URL is required",
  );
});

Deno.test("loadConfigFromEnv - custom env var names", () => {
  const config = loadConfigFromEnv({
    backendUrlVar: "MY_BACKEND",
    identitySeedVar: "MY_SEED",
    getEnv: (key) => {
      if (key === "MY_BACKEND") return "memory://";
      if (key === "MY_SEED") return "custom-seed";
      return undefined;
    },
  });
  assertEquals(config.use, "memory://");
  assertEquals(config.identitySeed, "custom-seed");
});

Deno.test("loadConfigFromEnv - trims whitespace in URLs", () => {
  const config = loadConfigFromEnv({
    getEnv: (key) => {
      if (key === "BACKEND_URL") {
        return "  memory://  ,  https://node.b3nd.net  ";
      }
      return undefined;
    },
  });
  assertEquals(config.use, ["memory://", "https://node.b3nd.net"]);
});
