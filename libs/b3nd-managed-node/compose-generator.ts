/**
 * Docker Compose generator for managed node networks.
 *
 * Takes a NetworkManifest and generates a docker-compose.yml that includes:
 * - A config-server node (memory-backed) for storing configs
 * - Database services (postgres, mongo) as needed
 * - One managed-node container per node in the manifest
 */

import type { NetworkManifest, NetworkNodeEntry } from "./types.ts";

interface ComposeService {
  image?: string;
  build?: { context: string; dockerfile: string };
  ports?: string[];
  environment?: Record<string, string>;
  depends_on?: string[];
  volumes?: string[];
  restart?: string;
}

interface ComposeFile {
  version: string;
  services: Record<string, ComposeService>;
  volumes?: Record<string, unknown>;
}

export interface ComposeGeneratorOptions {
  /** Path to the b3nd project root (for build context) */
  projectRoot?: string;
  /** Use pre-built images instead of building from source */
  useImages?: boolean;
  /** Image name for managed node containers */
  managedNodeImage?: string;
  /** Image name for config server containers */
  configServerImage?: string;
  /** Operator's Ed25519 public key hex */
  operatorPubKeyHex: string;
}

/**
 * Generate a docker-compose.yml from a NetworkManifest.
 */
export function generateCompose(
  manifest: NetworkManifest,
  options: ComposeGeneratorOptions,
): string {
  const compose: ComposeFile = {
    version: "3.8",
    services: {},
    volumes: {},
  };

  const needsPostgres = manifest.nodes.some((n) =>
    n.config.backends.some((b) => b.type === "postgresql")
  );
  const needsMongo = manifest.nodes.some((n) =>
    n.config.backends.some((b) => b.type === "mongodb")
  );

  // ── Config server ───────────────────────────────────────────────
  compose.services["config-server"] = {
    ...(options.useImages
      ? { image: options.configServerImage ?? "b3nd-node:latest" }
      : {
          build: {
            context: options.projectRoot ?? ".",
            dockerfile: "apps/b3nd-node/Dockerfile",
          },
        }),
    ports: ["9900:9900"],
    environment: {
      BACKEND_URL: "memory://",
      SCHEMA_MODULE: "./example-schema.ts",
      PORT: "9900",
      CORS_ORIGIN: "*",
    },
    restart: "unless-stopped",
  };

  // ── Database services ───────────────────────────────────────────
  if (needsPostgres) {
    compose.services["postgres"] = {
      image: "postgres:16-alpine",
      ports: ["5432:5432"],
      environment: {
        POSTGRES_USER: "b3nd",
        POSTGRES_PASSWORD: "b3nd",
        POSTGRES_DB: "b3nd",
      },
      volumes: ["pgdata:/var/lib/postgresql/data"],
      restart: "unless-stopped",
    };
    compose.volumes!["pgdata"] = {};
  }

  if (needsMongo) {
    compose.services["mongo"] = {
      image: "mongo:7",
      ports: ["27017:27017"],
      volumes: ["mongodata:/data/db"],
      restart: "unless-stopped",
    };
    compose.volumes!["mongodata"] = {};
  }

  // ── Managed node containers ─────────────────────────────────────
  for (const node of manifest.nodes) {
    const serviceName = sanitizeServiceName(node.name);
    const deps: string[] = ["config-server"];
    if (node.config.backends.some((b) => b.type === "postgresql")) deps.push("postgres");
    if (node.config.backends.some((b) => b.type === "mongodb")) deps.push("mongo");

    compose.services[serviceName] = {
      ...(options.useImages
        ? { image: options.managedNodeImage ?? "b3nd-node:latest" }
        : {
            build: {
              context: options.projectRoot ?? ".",
              dockerfile: "apps/b3nd-node/Dockerfile",
            },
          }),
      ports: [`${node.config.server.port}:${node.config.server.port}`],
      environment: {
        // Phase 1: bootstrap node
        PORT: String(node.config.server.port),
        CORS_ORIGIN: node.config.server.corsOrigin,
        BACKEND_URL: "memory://",
        // Phase 2: managed mode
        NODE_ID: node.publicKey,
        NODE_PRIVATE_KEY_PEM: `\${${serviceName.toUpperCase().replace(/-/g, "_")}_PRIVATE_KEY_PEM}`,
        OPERATOR_KEY: options.operatorPubKeyHex,
        CONFIG_URL: "http://config-server:9900",
        NODE_ENCRYPTION_PUBLIC_KEY_HEX: node.encryptionPublicKey ?? "",
        OPERATOR_ENCRYPTION_PUBLIC_KEY_HEX: `\${OPERATOR_ENCRYPTION_PUBLIC_KEY_HEX}`,
      },
      depends_on: deps,
      restart: "unless-stopped",
    };
  }

  // Remove empty volumes section
  if (Object.keys(compose.volumes!).length === 0) {
    delete compose.volumes;
  }

  return toYaml(compose);
}

function sanitizeServiceName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();
}

/**
 * Minimal YAML serializer (avoids pulling in a full YAML library).
 */
function toYaml(obj: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);

  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "string") {
    if (obj.includes("\n") || obj.includes("${")) return `"${obj.replace(/"/g, '\\"')}"`;
    return obj;
  }
  if (typeof obj === "number" || typeof obj === "boolean") return String(obj);

  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    return obj.map((item) => {
      if (typeof item === "string" || typeof item === "number") {
        return `${pad}- ${toYaml(item)}`;
      }
      return `${pad}- ${toYaml(item, indent + 1).trimStart()}`;
    }).join("\n");
  }

  if (typeof obj === "object") {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return entries.map(([key, value]) => {
      if (value === null || value === undefined) return `${pad}${key}:`;
      if (typeof value === "object" && !Array.isArray(value)) {
        const inner = toYaml(value, indent + 1);
        return `${pad}${key}:\n${inner}`;
      }
      if (Array.isArray(value)) {
        const inner = toYaml(value, indent + 1);
        return `${pad}${key}:\n${inner}`;
      }
      return `${pad}${key}: ${toYaml(value)}`;
    }).join("\n");
  }

  return String(obj);
}
