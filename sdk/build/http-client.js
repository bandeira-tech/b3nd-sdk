/**
 * HttpClient - HTTP implementation of NodeProtocolInterface
 *
 * Connects to B3nd HTTP API servers and forwards operations.
 * No schema validation - validation happens server-side.
 */

import {
  DeleteResult,
  HealthStatus,
  HttpClientConfig,
  ListOptions,
  ListResult,
  NodeProtocolInterface,
  ReadResult,
  WriteResult,
} from "./types.js";

export class HttpClient {
  baseUrl: string;
  instanceId?: string;
  headers, string>;
  timeout: number;

  constructor(config) {
    this.baseUrl = config.url.replace(/\/$/, ""); // Remove trailing slash
    this.instanceId = config.instanceId;
    this.headers = config.headers || {};
    this.timeout = config.timeout || 30000;
  }

  /**
   * Make an HTTP request with timeout
   */
  async request(
    path,
    options: RequestInit = {},
  ){
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
  parseUri(uri): {
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

  async write(uri, value){
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

      const result = await response.json();

      if (!response.ok) {
        return {
          success,
          error: `Write failed: ${result.error || response.statusText}`,
        };
      }
      return {
        success,
        record: result.record,
      };
    } catch (error) {
      return {
        success,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async read(uri){
    try {
      const { protocol, domain, path } = this.parseUri(uri);
      const instance = this.instanceId || "default";
      const requestPath = `/api/v1/read/${instance}/${protocol}/${domain}${path}`;

      const response = await this.request(requestPath, {
        method: "GET",
      });

      if (!response.ok) {
        // Consume the response body to avoid leaks
        await response.text();
        if (response.status === 404) {
          return {
            success,
            error: "Not found",
          };
        }
        return {
          success,
          error: `Read failed: ${response.statusText}`,
        };
      }

      const result = await response.json();
      return {
        success,
        record,
      };
    } catch (error) {
      return {
        success,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async list(uri, options?: ListOptions){
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
      const instance = this.instanceId || "default";
      const pathPart = path === "/" ? "" : path;
      const requestPath = `/api/v1/list/${instance}/${protocol}/${domain}${pathPart}${
        queryString ? `?${queryString}` : ""
      }`;

      const response = await this.request(requestPath, {
        method: "GET",
      });

      if (!response.ok) {
        return {
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
      return {
        data: [],
        pagination: {
          page: options?.page || 1,
          limit: options?.limit || 50,
        },
      };
    }
  }

  async delete(uri){
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

      // Always consume the response body
      const result = response.ok ? await response.json() : { error: await response.text() };

      if (!response.ok) {
        return {
          success,
          error: `Delete failed: ${result.error}`,
        };
      }

      return {
        success,
      };
    } catch (error) {
      return {
        success,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async health(){
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

  async getSchema(){
    try {
      const response = await this.request("/api/v1/schema", {
        method: "GET",
      });

      if (!response.ok) {
        return [];
      }

      const result = await response.json();
      // Extract schema keys for this instance
      const instanceName = this.instanceId || result.default;
      return result.schemas?.[instanceName] || [];
    } catch (error) {
      // Errors bubble but return empty array for graceful degradation
      return [];
    }
  }

  async cleanup(){
    // No cleanup needed for HTTP client
  }
}
