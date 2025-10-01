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
      const requestPath = `/api/v1/list/${instance}/${protocol}/${domain}${path.replace(/\/$/,'')}${
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

  async getSchema() {
    try {
      const response = await this.request("/api/v1/schema", {
        method: "GET",
      });

      if (!response.ok) {
        return [];
      }

      const result = await response.json();
      const instanceName = this.instanceId || result.default;
      return result.schemas?.[instanceName] || [];
    } catch (error) {
      console.error("Failed to fetch schema:", error);
      return [];
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

// Mock Client for browser testing
export class MockClient {
  constructor() {
    this.mockData = new Map();
  }

  async write(uri, value) {
    const record = { ts: Date.now(), data: value };
    this.mockData.set(uri, record);
    return { success: true, record };
  }

  async read(uri) {
    const record = this.mockData.get(uri);
    if (!record) {
      return { success: false, error: "Not found" };
    }
    return { success: true, record };
  }

  async list(uri, options = {}) {
    const entries = Array.from(this.mockData.keys())
      .filter(key => key.startsWith(uri))
      .map(key => ({
        uri: key,
        name: key.split('/').pop() || key,
        type: "file",
      }));

    return {
      data: entries,
      pagination: {
        page: options.page || 1,
        limit: options.limit || 50,
      },
    };
  }

  async delete(uri) {
    if (this.mockData.has(uri)) {
      this.mockData.delete(uri);
      return { success: true };
    }
    return { success: false, error: "Not found" };
  }

  async health() {
    return { status: "healthy", message: "Mock client operational" };
  }

  async getSchema() {
    return ["mock://example"];
  }

  async cleanup() {
    this.mockData.clear();
  }
}

// Browser Instance Manager
export class BrowserInstanceManager {
  constructor() {
    this.clients = new Map();
    this.defaultInstance = undefined;
  }

  async initialize(config) {
    this.defaultInstance = config.default;

    for (const [name, instanceConfig] of Object.entries(config.instances)) {
      const client = this.createClient(name, instanceConfig);
      this.clients.set(name, client);
      console.log(`[BrowserInstanceManager] Initialized instance '${name}'`);
    }

    if (!this.defaultInstance && this.clients.size > 0) {
      this.defaultInstance = Array.from(this.clients.keys())[0];
      console.log(`[BrowserInstanceManager] Using '${this.defaultInstance}' as default`);
    }
  }

  createClient(name, config) {
    switch (config.type) {
      case "http":
        return createHttpClient(config.baseUrl, {
          instanceId: config.instanceId,
          headers: config.headers,
          timeout: config.timeout,
        });
      case "mock":
        return new MockClient();
      default:
        throw new Error(`Unknown client type: ${config.type}`);
    }
  }

  getClient(name) {
    const instanceName = name || this.defaultInstance;
    if (!instanceName) {
      throw new Error("No instance name provided and no default instance set");
    }

    const client = this.clients.get(instanceName);
    if (!client) {
      throw new Error(
        `Client instance '${instanceName}' not found. Available: ${
          Array.from(this.clients.keys()).join(", ")
        }`
      );
    }

    return client;
  }

  getInstanceNames() {
    return Array.from(this.clients.keys());
  }

  getDefaultInstance() {
    return this.defaultInstance;
  }

  async getSchemas() {
    const result = {};
    for (const [name, client] of this.clients) {
      result[name] = await client.getSchema();
    }
    return result;
  }

  async cleanup() {
    const cleanupPromises = Array.from(this.clients.values()).map((client) =>
      client.cleanup()
    );
    await Promise.all(cleanupPromises);
    this.clients.clear();
  }
}

// Singleton for browser
let browserManagerInstance = null;

export function getBrowserInstanceManager() {
  if (!browserManagerInstance) {
    browserManagerInstance = new BrowserInstanceManager();
  }
  return browserManagerInstance;
}

export function resetBrowserInstanceManager() {
  if (browserManagerInstance) {
    browserManagerInstance.cleanup();
    browserManagerInstance = null;
  }
}
