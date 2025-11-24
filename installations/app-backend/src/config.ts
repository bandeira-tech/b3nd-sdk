interface AppBackendConfig {
  port: number;
  dataNodeUrl: string;
  walletServerUrl: string;
  walletApiBasePath: string;
}

export function loadConfig(): AppBackendConfig {
  const port = Number(Deno.env.get("APP_PORT") || "8844");
  const dataNodeUrl = Deno.env.get("DATA_NODE_URL") || "http://localhost:8842";
  const walletServerUrl = Deno.env.get("WALLET_SERVER_URL") ||
    "http://localhost:8843";
  const walletApiBasePath = Deno.env.get("WALLET_API_BASE_PATH") || "/api/v1";
  return { port, dataNodeUrl, walletServerUrl, walletApiBasePath };
}
