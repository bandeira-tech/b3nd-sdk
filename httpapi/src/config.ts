import { z } from "zod";

export const ServerConfigSchema = z.object({
  port: z.number().int().positive().default(8000),
  cors: z.object({
    origin: z.array(z.string()).default(["*"]),
    credentials: z.boolean().default(false),
    methods: z.array(z.string()).default(["GET", "POST", "DELETE", "OPTIONS"]),
    headers: z.array(z.string()).default(["Content-Type", "Authorization"]),
  }),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

export const PersistenceInstanceSchema = z.object({
  schema: z.string().url().or(z.string()),
  storage: z.enum(["memory", "file", "redis"]).default("memory"),
});

export const PersistenceConfigSchema = z.record(
  z.string(),
  PersistenceInstanceSchema,
);

export type PersistenceConfig = z.infer<typeof PersistenceConfigSchema>;

export async function loadServerConfig(
  configPath: string = "config/server.json",
): Promise<ServerConfig> {
  console.log(Deno.cwd());
  try {
    const content = await Deno.readTextFile(configPath);
    const parsed = JSON.parse(content);

    const portEnvOverride = Deno.env.get("API_PORT");
    parsed.port = portEnvOverride ? parseInt(portEnvOverride) : parsed.port;
    return ServerConfigSchema.parse(parsed);
  } catch (error) {
    console.error(`Failed to load server config from ${configPath}:`, error);
    throw error;
  }
}

export async function loadPersistenceConfig(
  configPath: string = "config/persistence.json",
): Promise<PersistenceConfig> {
  try {
    const content = await Deno.readTextFile(configPath);
    const parsed = JSON.parse(content);
    return PersistenceConfigSchema.parse(parsed);
  } catch (error) {
    console.error(
      `Failed to load persistence config from ${configPath}:`,
      error,
    );
    throw error;
  }
}
