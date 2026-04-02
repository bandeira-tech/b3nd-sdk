/**
 * HttpClient - HTTP implementation of NodeProtocolInterface
 *
 * Connects to B3nd HTTP API servers and forwards operations.
 * No schema validation - validation happens server-side.
 */

import type {
  HttpClientConfig,
  Message,
  NodeProtocolInterface,
  PersistenceRecord,
  ReadResult,
  ReceiveResult,
  StatusResult,
} from "../b3nd-core/types.ts";
import { encodeBase64 } from "../b3nd-core/encoding.ts";

/**
 * Serialize message data for JSON transport.
 * Wraps Uint8Array in a base64-encoded marker object to prevent JSON corruption.
 */
function serializeMsgData<D>(data: D): unknown {
  if (data instanceof Uint8Array) {
    return {
      __b3nd_binary__: true,
      encoding: "base64",
      data: encodeBase64(data),
    };
  }
  return data;
}

export class HttpClient implements NodeProtocolInterface {
  private baseUrl: string;
  private headers: Record<string, string>;
  private timeout: number;

  constructor(config: HttpClientConfig) {
    this.baseUrl = config.url.replace(/\/$/, ""); // Remove trailing slash
    this.headers = config.headers || {};
    this.timeout = config.timeout || 30000;
  }

  /**
   * Make an HTTP request with timeout
   */
  private async request(
    path: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const url = `${this.baseUrl}${path}`;
      const response = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...this.headers,
          ...options.headers,
        },
        signal: controller.signal,
      });

      return response;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Request timeout after ${this.timeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Parse URI into components
   * Example: "users://alice/profile" -> { protocol: "users", domain: "alice", path: "/profile" }
   */
  private parseUri(uri: string): {
    protocol: string;
    domain: string;
    path: string;
  } {
    const url = new URL(uri);
    return {
      protocol: url.protocol.replace(":", ""),
      domain: url.hostname,
      path: url.pathname,
    };
  }

  /**
   * Receive a message (unified interface)
   * POSTs to /api/v1/receive endpoint
   * @param msg - Message tuple [uri, data]
   * @returns ReceiveResult indicating acceptance
   */
  async receive<D = unknown>(msg: Message<D>): Promise<ReceiveResult> {
    const [uri] = msg;

    // Basic URI validation
    if (!uri || typeof uri !== "string") {
      return { accepted: false, error: "Message URI is required" };
    }

    try {
      const [uri, data] = msg;
      const serializedMsg = [uri, serializeMsgData(data)];
      const response = await this.request("/api/v1/receive", {
        method: "POST",
        body: JSON.stringify(serializedMsg),
      });

      const result = await response.json();

      if (!response.ok) {
        return {
          accepted: false,
          error: result.error || response.statusText,
        };
      }

      return {
        accepted: result.accepted ?? true,
        error: result.error,
      };
    } catch (error) {
      return {
        accepted: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async read<T = unknown>(uris: string | string[]): Promise<ReadResult<T>[]> {
    const uriList = Array.isArray(uris) ? uris : [uris];

    // Batch optimization: use read-multi endpoint for multiple non-list URIs
    const listUris = uriList.filter((u) => u.endsWith("/"));
    const singleUris = uriList.filter((u) => !u.endsWith("/"));

    const results: ReadResult<T>[] = [];

    // Handle list URIs individually
    for (const uri of listUris) {
      results.push(...await this._list<T>(uri));
    }

    // Handle single URIs — use batch endpoint when multiple
    if (singleUris.length === 1) {
      results.push(await this._readOne<T>(singleUris[0]));
    } else if (singleUris.length > 1) {
      try {
        const response = await this.request("/api/v1/read-multi", {
          method: "POST",
          body: JSON.stringify({ uris: singleUris }),
        });

        if (!response.ok) {
          if (response.status === 404) {
            // Consume the 404 body to avoid resource leaks
            await response.body?.cancel();
            // Fallback to individual reads if endpoint not available
            for (const uri of singleUris) {
              results.push(await this._readOne<T>(uri));
            }
          } else {
            await response.text();
            for (const uri of singleUris) {
              results.push({
                success: false,
                error: `Read failed: ${response.statusText}`,
              });
            }
          }
        } else {
          const batchResult = await response.json();
          // read-multi returns { results: [{ uri, success, record?, error? }] }
          if (batchResult.results && Array.isArray(batchResult.results)) {
            for (const item of batchResult.results) {
              if (item.success && item.record) {
                results.push({ success: true, record: item.record });
              } else {
                results.push({
                  success: false,
                  error: item.error || "Read failed",
                });
              }
            }
          }
        }
      } catch {
        // Fallback to individual reads on error
        for (const uri of singleUris) {
          results.push(await this._readOne<T>(uri));
        }
      }
    }

    return results;
  }

  private async _readOne<T>(uri: string): Promise<ReadResult<T>> {
    try {
      const { protocol, domain, path } = this.parseUri(uri);
      const requestPath = `/api/v1/read/${protocol}/${domain}${path}`;

      const response = await this.request(requestPath, {
        method: "GET",
      });

      if (!response.ok) {
        // Consume the response body to avoid leaks
        await response.text();
        if (response.status === 404) {
          return {
            success: false,
            error: "Not found",
          };
        }
        return {
          success: false,
          error: `Read failed: ${response.statusText}`,
        };
      }

      // Check Content-Type to determine if response is binary
      const contentType = response.headers.get("Content-Type") || "";
      const isBinary = contentType === "application/octet-stream" ||
        contentType.startsWith("image/") ||
        contentType.startsWith("audio/") ||
        contentType.startsWith("video/") ||
        contentType.startsWith("font/") ||
        contentType === "application/wasm";

      if (isBinary) {
        // Return binary data as Uint8Array
        const buffer = await response.arrayBuffer();
        const data = new Uint8Array(buffer) as unknown as T;
        return {
          success: true,
          record: { data, ts: Date.now() },
        };
      }

      const result = await response.json();
      return {
        success: true,
        record: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async _list<T>(uri: string): Promise<ReadResult<T>[]> {
    try {
      const { protocol, domain, path } = this.parseUri(uri);
      // Use trailing-slash read endpoint — returns ReadResult[] directly,
      // avoiding the N+1 round-trip of the old /api/v1/list/ + re-fetch pattern.
      const trailingPath = path.endsWith("/") ? path : `${path}/`;
      const requestPath = `/api/v1/read/${protocol}/${domain}${trailingPath}`;

      const response = await this.request(requestPath, {
        method: "GET",
      });

      if (!response.ok) {
        await response.text();
        return [];
      }

      const results = await response.json();

      // Server returns ReadResult[] for trailing-slash reads
      if (Array.isArray(results)) {
        return results as ReadResult<T>[];
      }

      return [];
    } catch {
      return [];
    }
  }

  async status(): Promise<StatusResult> {
    try {
      const response = await this.request("/api/v1/health", {
        method: "GET",
      });

      if (!response.ok) {
        return {
          status: "unhealthy",
          message: "Health check failed",
        };
      }

      const healthResult = await response.json();
      const status: StatusResult = {
        status: healthResult.status ?? "healthy",
        message: healthResult.message,
        details: healthResult.details,
      };

      // Try to fetch schema info
      try {
        const schemaResponse = await this.request("/api/v1/schema", {
          method: "GET",
        });
        if (schemaResponse.ok) {
          const schemaResult = await schemaResponse.json();
          if (schemaResult.schema && Array.isArray(schemaResult.schema)) {
            status.schema = schemaResult.schema;
          }
        }
      } catch {
        // Schema endpoint optional — ignore errors
      }

      return status;
    } catch (error) {
      return {
        status: "unhealthy",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
