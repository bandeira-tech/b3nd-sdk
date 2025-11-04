import type {
  BackendAdapter,
  PersistenceRecord,
  NavigationNode,
  SearchResult,
  SearchFilters,
  PaginatedResponse,
} from "../types";
import { HttpClient } from "@bandeira-tech/b3nd-sdk";

export class HttpAdapter implements BackendAdapter {
  name = "HTTP Backend";
  type = "http" as const;
  baseUrl: string;
  instanceId: string;
  private client: HttpClient;

  constructor(baseUrl: string, instanceId: string) {
    this.baseUrl = baseUrl;
    this.instanceId = instanceId;
    this.client = new HttpClient({ url: baseUrl });
  }

  async listPath(
    path: string,
    options?: { page?: number; limit?: number }
  ): Promise<PaginatedResponse<NavigationNode>> {
    // Root path should be handled by schema-driven navigation
    if (path === "/" || path === "") {
      throw new Error("Root path should be handled by schema-driven navigation, not listPath");
    }

    // Convert Explorer path format to URI: "/users/alice" -> "users://alice/"
    // Support protocol root: "/test/" -> "test://"
    const uri = this.pathToUri(path);

    // Use sdk HttpClient to list
    let listUri = uri;
    // Avoid breaking protocol roots like "test://" (would become "test:/")
    if (!listUri.endsWith("://")) {
      listUri = listUri.replace(/\/$/, "");
    }
    const result = await this.client.list(listUri, options);

    // Handle error response
    if (!result.success) {
      throw new Error(`Failed to list ${path}: ${result.error}`);
    }

    // Transform API response to Explorer format
    return {
      data: result.data.map((item: any) => {
        const itemPath = this.uriToPath(item.uri);
        // Extract name from URI (last segment of path)
        const name = this.extractNameFromUri(item.uri);
        return {
          path: itemPath,
          name: name,
          type: item.type as "file" | "directory",
          children: undefined, // Lazy load
        };
      }),
      pagination: result.pagination,
    };
  }

  async readRecord(path: string): Promise<PersistenceRecord> {
    // Convert Explorer path to URI
    const uri = this.pathToUri(path);

    // Use sdk HttpClient to read
    const result = await this.client.read(uri);

    if (!result.success || !result.record) {
      throw new Error(`Record not found: ${path}`);
    }

    return result.record;
  }

  async searchPaths(
    _query: string,
    _filters?: SearchFilters,
    options?: { page?: number; limit?: number }
  ): Promise<PaginatedResponse<SearchResult>> {
    // Not implemented yet; return empty set with pagination info
    return {
      data: [],
      pagination: {
        page: options?.page || 1,
        limit: options?.limit || 20,
      },
    };
  }

  async getSchema(): Promise<Record<string, string[]>> {
    const schemas = await this.client.getSchema();
    return { [this.instanceId]: schemas };
  }

  async healthCheck(): Promise<boolean> {
    const result = await this.client.health();
    return result.status === "healthy";
  }

  // Helper: Convert "/users/alice/profile" -> "users://alice/profile"
  private pathToUri(path: string): string {
    const parts = path.split("/").filter(Boolean);

    // Root path "/" should not be converted - this is handled by schema-driven navigation
    if (parts.length === 0) {
      throw new Error("Cannot convert root path '/' to URI - use schema-driven navigation");
    }

    // Allow protocol root: "/test" or "/test/" -> "test://"
    if (parts.length === 1) {
      const protocol = parts[0];
      return `${protocol}://`;
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

  // Helper: Extract display name from URI
  // "users://alice/profile" -> "profile"
  // "users://alice" -> "alice"
  private extractNameFromUri(uri: string): string {
    const url = new URL(uri);
    const pathname = url.pathname;

    // If pathname has content, get the last segment
    if (pathname && pathname !== "/") {
      const segments = pathname.split("/").filter(Boolean);
      return segments[segments.length - 1];
    }

    // Otherwise, use hostname as the name
    return url.hostname || "unnamed";
  }
}
