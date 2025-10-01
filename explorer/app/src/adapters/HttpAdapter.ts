import type {
  BackendAdapter,
  PersistenceRecord,
  NavigationNode,
  SearchResult,
  SearchFilters,
  PaginatedResponse,
} from "../types";
import { createHttpClient } from "../../../../client-sdk/browser.js";

export class HttpAdapter implements BackendAdapter {
  name = "HTTP Backend";
  type = "http" as const;
  baseUrl: string;
  private client: any; // B3ndClient type
  private instanceId: string;

  constructor(baseUrl: string = "http://localhost:8000", instanceId: string = "default") {
    this.baseUrl = baseUrl;
    this.instanceId = instanceId;
    this.client = createHttpClient(baseUrl, { instanceId });
  }

  async listPath(
    path: string,
    options?: { page?: number; limit?: number }
  ): Promise<PaginatedResponse<NavigationNode>> {
    try {
      // Root path should be handled by schema-driven navigation
      if (path === "/" || path === "") {
        throw new Error("Root path should be handled by schema-driven navigation, not listPath");
      }

      // Convert Explorer path format to URI: "/users/alice" -> "users://alice/"
      const uri = this.pathToUri(path);

      // Use client-sdk to list
      const result = await this.client.list(uri, options);

      // Transform API response to Explorer format
      // API returns array of path strings like ["/test-123", "/test-456"]
      return {
        data: result.data.map((pathString: string) => {
          // Convert path string to full URI for consistency
          const { protocol, domain } = new URL(uri);
          const fullUri = `${protocol}//${domain}${pathString}`;
          const itemPath = this.uriToPath(fullUri);
          const name = pathString.split("/").filter(Boolean).pop() || pathString;
          return {
            path: itemPath,
            name,
            type: "file" as const, // Default to file, could be enhanced later
            children: undefined, // Lazy load
          };
        }),
        pagination: result.pagination,
      };
    } catch (error) {
      console.error("List error:", error);
      throw error; // Re-throw to let caller handle
    }
  }

  async readRecord(path: string): Promise<PersistenceRecord> {
    // Convert Explorer path to URI
    const uri = this.pathToUri(path);

    // Use client-sdk to read
    const result = await this.client.read(uri);

    if (!result.success || !result.record) {
      throw new Error(`Record not found: ${path}`);
    }

    return result.record;
  }

  async searchPaths(
    query: string,
    filters?: SearchFilters,
    options?: { page?: number; limit?: number }
  ): Promise<PaginatedResponse<SearchResult>> {
    // TODO: Implement when search endpoint is added
    return {
      data: [],
      pagination: {
        page: options?.page || 1,
        limit: options?.limit || 20,
        total: 0,
        hasNext: false,
        hasPrev: false,
      },
    };
  }

  async getSchema(): Promise<Record<string, string[]>> {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/schema`);
      if (!response.ok) {
        console.error("Failed to fetch schema:", response.statusText);
        return {};
      }
      const result = await response.json();
      return result.schemas || {};
    } catch (error) {
      console.error("Error fetching schema:", error);
      return {};
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.client.health();
      return result.status === "healthy";
    } catch {
      return false;
    }
  }

  // Helper: Convert "/users/alice/profile" -> "users://alice/profile"
  private pathToUri(path: string): string {
    const parts = path.split("/").filter(Boolean);

    // Root path "/" should not be converted - this is handled by schema-driven navigation
    if (parts.length === 0) {
      throw new Error("Cannot convert root path '/' to URI - use schema-driven navigation");
    }

    if (parts.length < 2) {
      throw new Error(`Invalid path format: '${path}'. Expected format: /protocol/domain/path`);
    }

    const protocol = parts[0];
    const domain = parts[1];
    const subpath = "/" + parts.slice(2).join("/");
    return `${protocol}://${domain}${subpath}`;
  }

  // Helper: Convert "users://alice/profile" -> "/users/alice/profile"
  private uriToPath(uri: string): string {
    const url = new URL(uri);
    return `/${url.protocol.replace(":", "")}/${url.hostname}${url.pathname}`;
  }
}
