/**
 * HttpClient - HTTP implementation of NodeProtocolInterface
 *
 * Connects to B3nd HTTP API servers and forwards operations.
 * No schema validation - validation happens server-side.
 */

import type {
  DeleteResult,
  HealthStatus,
  HttpClientConfig,
  ListOptions,
  ListResult,
  NodeProtocolInterface,
  ReadMultiResult,
  ReadMultiResultItem,
  ReadResult,
  WriteResult,
} from "../../src/types.ts";

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

  async write<T = unknown>(uri: string, value: T): Promise<WriteResult<T>> {
    try {
      const { protocol, domain, path } = this.parseUri(uri);

      const requestPath = `/api/v1/write/${protocol}/${domain}${path}`;

      const response = await this.request(requestPath, {
        method: "POST",
        body: JSON.stringify({ value }),
      });

      const result = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: `Write failed: ${result.error || response.statusText}`,
        };
      }
      return {
        success: true,
        record: result.record,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async read<T = unknown>(uri: string): Promise<ReadResult<T>> {
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

  async readMulti<T = unknown>(uris: string[]): Promise<ReadMultiResult<T>> {
    // Enforce batch size limit
    if (uris.length > 50) {
      return {
        success: false,
        results: [],
        summary: { total: uris.length, succeeded: 0, failed: uris.length },
      };
    }

    try {
      const response = await this.request("/api/v1/read-multi", {
        method: "POST",
        body: JSON.stringify({ uris }),
      });

      if (!response.ok) {
        // Fallback to individual reads if endpoint not available
        if (response.status === 404) {
          return this.readMultiFallback<T>(uris);
        }
        return {
          success: false,
          results: uris.map((uri) => ({ uri, success: false, error: response.statusText })),
          summary: { total: uris.length, succeeded: 0, failed: uris.length },
        };
      }

      return await response.json();
    } catch (error) {
      // Fallback to individual reads on error
      return this.readMultiFallback<T>(uris);
    }
  }

  private async readMultiFallback<T = unknown>(uris: string[]): Promise<ReadMultiResult<T>> {
    const results: ReadMultiResultItem<T>[] = await Promise.all(
      uris.map(async (uri): Promise<ReadMultiResultItem<T>> => {
        const result = await this.read<T>(uri);
        if (result.success && result.record) {
          return { uri, success: true, record: result.record };
        }
        return { uri, success: false, error: result.error || "Read failed" };
      })
    );

    const succeeded = results.filter((r) => r.success).length;
    return {
      success: succeeded > 0,
      results,
      summary: { total: uris.length, succeeded, failed: uris.length - succeeded },
    };
  }

  async list(uri: string, options?: ListOptions): Promise<ListResult> {
    try {
      const { protocol, domain, path } = this.parseUri(uri);

      const params = new URLSearchParams();
      if (options?.page) {
        params.set("page", options.page.toString());
      }
      if (options?.limit) {
        params.set("limit", options.limit.toString());
      }
      if (options?.pattern) {
        params.set("pattern", options.pattern);
      }
      if (options?.sortBy) {
        params.set("sortBy", options.sortBy);
      }
      if (options?.sortOrder) {
        params.set("sortOrder", options.sortOrder);
      }

      const queryString = params.toString();
      const pathPart = path === "/" ? "" : path;
      const requestPath = `/api/v1/list/${protocol}/${domain}${pathPart}${
        queryString ? `?${queryString}` : ""
      }`;

      const response = await this.request(requestPath, {
        method: "GET",
      });

      if (!response.ok) {
        // SECURITY FIX: Return success: false on HTTP errors
        // Previously returned success: true which was misleading
        const errorText = await response.text().catch(() => response.statusText);
        return {
          success: false,
          error: `List failed: ${errorText || response.statusText}`,
          data: [],
          pagination: {
            page: options?.page || 1,
            limit: options?.limit || 50,
          },
        };
      }

      const result = await response.json();
      return result;
    } catch (error) {
      // SECURITY FIX: Return success: false and include error details
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        data: [],
        pagination: {
          page: options?.page || 1,
          limit: options?.limit || 50,
        },
      };
    }
  }

  async delete(uri: string): Promise<DeleteResult> {
    try {
      const { protocol, domain, path } = this.parseUri(uri);

      const requestPath = `/api/v1/delete/${protocol}/${domain}${path}`;

      const response = await this.request(requestPath, {
        method: "DELETE",
      });

      // Always consume the response body
      const result = response.ok ? await response.json() : { error: await response.text() };

      if (!response.ok) {
        return {
          success: false,
          error: `Delete failed: ${result.error}`,
        };
      }

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async health(): Promise<HealthStatus> {
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

      const result = await response.json();
      return result;
    } catch (error) {
      return {
        status: "unhealthy",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getSchema(): Promise<string[]> {
    try {
      const response = await this.request("/api/v1/schema", {
        method: "GET",
      });

      if (!response.ok) {
        return [];
      }

      const result = await response.json();

      // API returns schema array directly
      if (result.schema && Array.isArray(result.schema)) {
        return result.schema;
      }

      // Fallback to empty array if schema not found
      return [];
    } catch (error) {
      // Errors bubble but return empty array for graceful degradation
      return [];
    }
  }

  async cleanup(): Promise<void> {
    // No cleanup needed for HTTP client
  }
}
