interface AppBackendConfig {
  port: number;
  dataNodeUrl: string;
}

export function loadConfig(): AppBackendConfig {
  const port = Number(Deno.env.get("APP_PORT") || "3003");
  const dataNodeUrl = Deno.env.get("DATA_NODE_URL") || "http://localhost:8080";
  return { port, dataNodeUrl };
}

