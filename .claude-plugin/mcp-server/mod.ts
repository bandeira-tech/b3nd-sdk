#!/usr/bin/env -S deno run -A
/**
 * B3nd MCP Server
 *
 * Model Context Protocol server for B3nd SDK.
 * Provides tools to read, receive transactions, list, and manage data in B3nd backends.
 * Supports multiple backends with dynamic switching.
 */

/// <reference lib="deno.ns" />

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { HttpClient } from "@bandeira-tech/b3nd-sdk";

// Backend configuration
interface BackendConfig {
  name: string;
  url: string;
  description?: string;
}

// State management
class BackendManager {
  private backends: Map<string, BackendConfig> = new Map();
  private clients: Map<string, HttpClient> = new Map();
  private activeBackendName: string | null = null;

  constructor() {
    // Load default backends from environment
    this.loadFromEnv();
  }

  private loadFromEnv() {
    // Parse B3ND_BACKENDS env var: "local=http://localhost:8842,testnet=https://testnet.b3nd.io"
    const backendsEnv = Deno.env.get("B3ND_BACKENDS");
    if (backendsEnv) {
      for (const entry of backendsEnv.split(",")) {
        const [name, url] = entry.split("=").map((s) => s.trim());
        if (name && url) {
          this.addBackend(name, url);
        }
      }
    }

    // Also support single backend URL for backwards compatibility
    const defaultUrl = Deno.env.get("B3ND_BACKEND_URL");
    if (defaultUrl && !this.backends.has("default")) {
      this.addBackend("default", defaultUrl, "Default backend");
    }

    // Add local as fallback if no backends configured
    if (this.backends.size === 0) {
      this.addBackend("local", "http://localhost:8842", "Local development server");
    }

    // Set first backend as active
    if (!this.activeBackendName && this.backends.size > 0) {
      this.activeBackendName = this.backends.keys().next().value ?? null;
    }
  }

  addBackend(name: string, url: string, description?: string): void {
    this.backends.set(name, { name, url, description });
    this.clients.set(name, new HttpClient({ url }));

    // If this is the first backend, make it active
    if (!this.activeBackendName) {
      this.activeBackendName = name;
    }
  }

  removeBackend(name: string): boolean {
    if (!this.backends.has(name)) {
      return false;
    }

    this.backends.delete(name);
    this.clients.delete(name);

    // If we removed the active backend, switch to another
    if (this.activeBackendName === name) {
      this.activeBackendName = this.backends.keys().next().value ?? null;
    }

    return true;
  }

  switchBackend(name: string): boolean {
    if (!this.backends.has(name)) {
      return false;
    }
    this.activeBackendName = name;
    return true;
  }

  getActiveBackend(): { config: BackendConfig; client: HttpClient } | null {
    if (!this.activeBackendName) {
      return null;
    }
    const config = this.backends.get(this.activeBackendName);
    const client = this.clients.get(this.activeBackendName);
    if (!config || !client) {
      return null;
    }
    return { config, client };
  }

  getActiveBackendName(): string | null {
    return this.activeBackendName;
  }

  listBackends(): BackendConfig[] {
    return Array.from(this.backends.values());
  }

  getBackend(name: string): { config: BackendConfig; client: HttpClient } | null {
    const config = this.backends.get(name);
    const client = this.clients.get(name);
    if (!config || !client) {
      return null;
    }
    return { config, client };
  }
}

// Initialize backend manager
const backendManager = new BackendManager();

// Create MCP server
const server = new Server(
  {
    name: "b3nd-mcp",
    version: "0.2.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// Tool definitions
const TOOLS = [
  // Backend management tools
  {
    name: "b3nd_backends_list",
    description: "List all configured B3nd backends and show which one is currently active.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "b3nd_backends_switch",
    description: "Switch to a different B3nd backend by name (e.g., 'local', 'testnet', 'mainnet').",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Name of the backend to switch to",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "b3nd_backends_add",
    description: "Add a new B3nd backend configuration.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Unique name for the backend (e.g., 'testnet', 'staging')",
        },
        url: {
          type: "string",
          description: "Backend URL (e.g., 'https://testnet.b3nd.io')",
        },
        description: {
          type: "string",
          description: "Optional description of the backend",
        },
      },
      required: ["name", "url"],
    },
  },
  {
    name: "b3nd_backends_remove",
    description: "Remove a B3nd backend configuration.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Name of the backend to remove",
        },
      },
      required: ["name"],
    },
  },
  // Data operation tools
  {
    name: "b3nd_read",
    description: "Read data from a B3nd URI using the active backend. Returns the stored record with timestamp and data.",
    inputSchema: {
      type: "object" as const,
      properties: {
        uri: {
          type: "string",
          description: "The B3nd URI to read from (e.g., 'mutable://users/alice/profile')",
        },
        backend: {
          type: "string",
          description: "Optional: specific backend to use (defaults to active backend)",
        },
      },
      required: ["uri"],
    },
  },
  {
    name: "b3nd_receive",
    description: "Receive a transaction to store data at a B3nd URI. This is the unified interface for all state changes. Accepts a transaction tuple [uri, data].",
    inputSchema: {
      type: "object" as const,
      properties: {
        tx: {
          type: "array",
          description: "The transaction tuple [uri, data] - first element is URI string, second is data object",
          minItems: 2,
          maxItems: 2,
        },
        backend: {
          type: "string",
          description: "Optional: specific backend to use (defaults to active backend)",
        },
      },
      required: ["tx"],
    },
  },
  {
    name: "b3nd_list",
    description: "List items at a B3nd URI path using the active backend. Returns directories and files under the path.",
    inputSchema: {
      type: "object" as const,
      properties: {
        uri: {
          type: "string",
          description: "The B3nd URI path to list (e.g., 'mutable://users/')",
        },
        limit: {
          type: "number",
          description: "Maximum number of items to return (default: 100)",
        },
        page: {
          type: "number",
          description: "Page number for pagination (default: 1)",
        },
        backend: {
          type: "string",
          description: "Optional: specific backend to use (defaults to active backend)",
        },
      },
      required: ["uri"],
    },
  },
  {
    name: "b3nd_delete",
    description: "Delete data at a B3nd URI using the active backend.",
    inputSchema: {
      type: "object" as const,
      properties: {
        uri: {
          type: "string",
          description: "The B3nd URI to delete",
        },
        backend: {
          type: "string",
          description: "Optional: specific backend to use (defaults to active backend)",
        },
      },
      required: ["uri"],
    },
  },
  {
    name: "b3nd_health",
    description: "Check the health status of the active B3nd backend (or a specific backend).",
    inputSchema: {
      type: "object" as const,
      properties: {
        backend: {
          type: "string",
          description: "Optional: specific backend to check (defaults to active backend)",
        },
      },
    },
  },
  {
    name: "b3nd_schema",
    description: "Get the schema (available protocols) from the active B3nd backend.",
    inputSchema: {
      type: "object" as const,
      properties: {
        backend: {
          type: "string",
          description: "Optional: specific backend to query (defaults to active backend)",
        },
      },
    },
  },
];

// Helper to get client for operation
function getClient(backendName?: string): { client: HttpClient; config: BackendConfig } {
  if (backendName) {
    const backend = backendManager.getBackend(backendName);
    if (!backend) {
      throw new Error(`Backend '${backendName}' not found. Use b3nd_backends_list to see available backends.`);
    }
    return backend;
  }

  const active = backendManager.getActiveBackend();
  if (!active) {
    throw new Error("No active backend. Use b3nd_backends_add to add a backend first.");
  }
  return active;
}

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // Backend management
      case "b3nd_backends_list": {
        const backends = backendManager.listBackends();
        const activeName = backendManager.getActiveBackendName();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  activeBackend: activeName,
                  backends: backends.map((b) => ({
                    ...b,
                    isActive: b.name === activeName,
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "b3nd_backends_switch": {
        const { name: backendName } = args as { name: string };
        const success = backendManager.switchBackend(backendName);
        if (success) {
          const active = backendManager.getActiveBackend();
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: true,
                    message: `Switched to backend '${backendName}'`,
                    activeBackend: active?.config,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } else {
          const backends = backendManager.listBackends();
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: false,
                    error: `Backend '${backendName}' not found`,
                    availableBackends: backends.map((b) => b.name),
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }
      }

      case "b3nd_backends_add": {
        const { name: backendName, url, description } = args as {
          name: string;
          url: string;
          description?: string;
        };
        backendManager.addBackend(backendName, url, description);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  message: `Added backend '${backendName}'`,
                  backend: { name: backendName, url, description },
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "b3nd_backends_remove": {
        const { name: backendName } = args as { name: string };
        const success = backendManager.removeBackend(backendName);
        if (success) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: true,
                    message: `Removed backend '${backendName}'`,
                    activeBackend: backendManager.getActiveBackendName(),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: false,
                    error: `Backend '${backendName}' not found`,
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }
      }

      // Data operations
      case "b3nd_read": {
        const { uri, backend: backendName } = args as { uri: string; backend?: string };
        const { client, config } = getClient(backendName);
        const result = await client.read(uri);
        if (result.success) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: true,
                    backend: config.name,
                    uri,
                    timestamp: result.record?.ts,
                    data: result.record?.data,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  { success: false, backend: config.name, uri, error: result.error },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }
      }

      case "b3nd_receive": {
        const { tx, backend: backendName } = args as {
          tx: [string, unknown];
          backend?: string;
        };
        const { client, config } = getClient(backendName);
        const result = await client.receive(tx);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  accepted: result.accepted,
                  backend: config.name,
                  uri: tx[0],
                  error: result.error,
                },
                null,
                2
              ),
            },
          ],
          isError: !result.accepted,
        };
      }

      case "b3nd_list": {
        const { uri, limit, page, backend: backendName } = args as {
          uri: string;
          limit?: number;
          page?: number;
          backend?: string;
        };
        const { client, config } = getClient(backendName);
        const result = await client.list(uri, { limit: limit || 100, page: page || 1 });
        if (result.success) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: true,
                    backend: config.name,
                    uri,
                    items: result.data,
                    pagination: result.pagination,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  { success: false, backend: config.name, uri, error: result.error },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }
      }

      case "b3nd_delete": {
        const { uri, backend: backendName } = args as { uri: string; backend?: string };
        const { client, config } = getClient(backendName);
        const result = await client.delete(uri);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: result.success,
                  backend: config.name,
                  uri,
                  error: result.error,
                },
                null,
                2
              ),
            },
          ],
          isError: !result.success,
        };
      }

      case "b3nd_health": {
        const { backend: backendName } = args as { backend?: string };
        const { client, config } = getClient(backendName);
        const result = await client.health();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  backend: config.name,
                  url: config.url,
                  status: result.status,
                  message: result.message,
                  details: result.details,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "b3nd_schema": {
        const { backend: backendName } = args as { backend?: string };
        const { client, config } = getClient(backendName);
        const schemas = await client.getSchema();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  backend: config.name,
                  url: config.url,
                  protocols: schemas,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: message, tool: name }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// Handle list resources request
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const active = backendManager.getActiveBackend();
  if (!active) {
    return { resources: [] };
  }

  try {
    const schemas = await active.client.getSchema();
    const resources = schemas.map((protocol) => ({
      uri: `b3nd://${active.config.name}/${protocol}`,
      name: `${protocol} (${active.config.name})`,
      description: `B3nd protocol: ${protocol} on ${active.config.name}`,
      mimeType: "application/json",
    }));
    return { resources };
  } catch {
    return { resources: [] };
  }
});

// Handle read resource request
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const resourceUri = request.params.uri;

  // Parse b3nd://backend/protocol://path format
  const match = resourceUri.match(/^b3nd:\/\/([^/]+)\/(.+)$/);
  if (!match) {
    return {
      contents: [
        {
          uri: resourceUri,
          mimeType: "application/json",
          text: JSON.stringify({ error: "Invalid resource URI format" }),
        },
      ],
    };
  }

  const [, backendName, b3ndUri] = match;

  try {
    const { client } = getClient(backendName);
    const result = await client.read(b3ndUri);
    if (result.success) {
      return {
        contents: [
          {
            uri: resourceUri,
            mimeType: "application/json",
            text: JSON.stringify(result.record?.data, null, 2),
          },
        ],
      };
    } else {
      return {
        contents: [
          {
            uri: resourceUri,
            mimeType: "application/json",
            text: JSON.stringify({ error: result.error }),
          },
        ],
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      contents: [
        {
          uri: resourceUri,
          mimeType: "application/json",
          text: JSON.stringify({ error: message }),
        },
      ],
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const backends = backendManager.listBackends();
  const active = backendManager.getActiveBackendName();
  console.error(`B3nd MCP Server v0.2.0 started`);
  console.error(`Active backend: ${active}`);
  console.error(`Configured backends: ${backends.map((b) => b.name).join(", ")}`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  Deno.exit(1);
});
