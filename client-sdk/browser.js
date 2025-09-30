/**
 * Browser-compatible B3ND Client SDK
 * Simplified version for use in browser/Vite environments
 */

export class HttpClient {
  constructor(config) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.instanceId = config.instanceId;
    this.headers = config.headers || {};
    this.timeout = config.timeout || 30000;
  }

  async request(path, options = {}) {
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

  parseUri(uri) {
    const url = new URL(uri);
    return {
      protocol: url.protocol.replace(":", ""),
      domain: url.hostname,
      path: url.pathname,
    };
  }

  async write(uri, value) {
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

  async read(uri) {
    try {
      const { protocol, domain, path } = this.parseUri(uri);
      const instance = this.instanceId || "default";
      const requestPath = `/api/v1/read/${instance}/${protocol}/${domain}${path}`;

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
        record: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Read failed",
      };
    }
  }

  async list(uri, options = {}) {
    try {
      const { protocol, domain, path } = this.parseUri(uri);

      const params = new URLSearchParams();
      if (options.page) {
        params.set("page", options.page.toString());
      }
      if (options.limit) {
        params.set("limit", options.limit.toString());
      }
      if (options.pattern) {
        params.set("pattern", options.pattern);
      }
      if (options.sortBy) {
        params.set("sortBy", options.sortBy);
      }
      if (options.sortOrder) {
        params.set("sortOrder", options.sortOrder);
      }

      const queryString = params.toString();
      const instance = this.instanceId || "default";
      const requestPath = `/api/v1/list/${instance}/${protocol}/${domain}${path}${
        queryString ? `?${queryString}` : ""
      }`;

      const response = await this.request(requestPath, {
        method: "GET",
      });

      if (!response.ok) {
        return {
          data: [],
          pagination: {
            page: options.page || 1,
            limit: options.limit || 50,
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
          page: options.page || 1,
          limit: options.limit || 50,
          total: 0,
          hasNext: false,
          hasPrev: false,
        },
      };
    }
  }

  async delete(uri) {
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

  async health() {
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

  async cleanup() {
    // No cleanup needed for HTTP client
  }
}

export function createHttpClient(baseUrl, options = {}) {
  return new HttpClient({
    type: "http",
    baseUrl,
    ...options,
  });
}
