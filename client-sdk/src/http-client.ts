/**
 * HTTP Client Implementation
 * Connects to b3nd HTTP API servers
 */

import type {
  B3ndClient,
  ClientError,
  DeleteResult,
  HttpClientConfig,
  ListOptions,
  ListResult,
  ReadResult,
  WriteResult,
} from "./types.ts";

export class HttpClient implements B3ndClient {
  private baseUrl: string;
  private instanceId?: string;
  private headers: Record<string, string>;
  private timeout: number;

  constructor(config: HttpClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ""); // Remove trailing slash
    this.instanceId = config.instanceId;
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

      const params = new URLSearchParams();
      if (this.instanceId) {
        params.set("instance", this.instanceId);
      }

      const queryString = params.toString();
      const requestPath = `/api/v1/write/${protocol}/${domain}${path}${
        queryString ? `?${queryString}` : ""
      }`;

      const response = await this.request(requestPath, {
        method: "POST",
        body: JSON.stringify({ value }),
      });

      if (!response.ok) {
        const error = await response.text();
        return {
          success: false,
          error: `Write failed: ${error}`,
        };
      }

      const result = await response.json();
      return {
        success: true,
        record: result.record,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Write failed",
      };
    }
  }

  async read<T = unknown>(uri: string): Promise<ReadResult<T>> {
    try {
      const { protocol, domain, path } = this.parseUri(uri);

      const params = new URLSearchParams();
      if (this.instanceId) {
        params.set("instance", this.instanceId);
      }

      const queryString = params.toString();
      const requestPath = `/api/v1/read/${protocol}/${domain}${path}${
        queryString ? `?${queryString}` : ""
      }`;

      const response = await this.request(requestPath, {
        method: "GET",
      });

      if (!response.ok) {
        if (response.status === 404) {
          return {
            success: false,
            error: "Not found",
          };
        }
        const error = await response.text();
        return {
          success: false,
          error: `Read failed: ${error}`,
        };
      }

      const result = await response.json();
      return {
        success: true,
        record: result.record,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Read failed",
      };
    }
  }

  async list(uri: string, options?: ListOptions): Promise<ListResult> {
    try {
      const { protocol, domain, path } = this.parseUri(uri);

      const params = new URLSearchParams();
      if (this.instanceId) {
        params.set("instance", this.instanceId);
      }
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
      const requestPath = `/api/v1/list/${protocol}/${domain}${path}${
        queryString ? `?${queryString}` : ""
      }`;

      const response = await this.request(requestPath, {
        method: "GET",
      });

      if (!response.ok) {
        const error = await response.text();
        return {
          data: [],
          pagination: {
            page: options?.page || 1,
            limit: options?.limit || 50,
            total: 0,
            hasNext: false,
            hasPrev: false,
          },
        };
      }

      const result = await response.json();
      return result;
    } catch (error) {
      return {
        data: [],
        pagination: {
          page: options?.page || 1,
          limit: options?.limit || 50,
          total: 0,
          hasNext: false,
          hasPrev: false,
        },
      };
    }
  }

  async delete(uri: string): Promise<DeleteResult> {
    try {
      const { protocol, domain, path } = this.parseUri(uri);

      const params = new URLSearchParams();
      if (this.instanceId) {
        params.set("instance", this.instanceId);
      }

      const queryString = params.toString();
      const requestPath = `/api/v1/delete/${protocol}/${domain}${path}${
        queryString ? `?${queryString}` : ""
      }`;

      const response = await this.request(requestPath, {
        method: "DELETE",
      });

      if (!response.ok) {
        const error = await response.text();
        return {
          success: false,
          error: `Delete failed: ${error}`,
        };
      }

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Delete failed",
      };
    }
  }

  async health(): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    message?: string;
  }> {
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
        message: error instanceof Error ? error.message : "Health check failed",
      };
    }
  }

  async cleanup(): Promise<void> {
    // No cleanup needed for HTTP client
  }
}