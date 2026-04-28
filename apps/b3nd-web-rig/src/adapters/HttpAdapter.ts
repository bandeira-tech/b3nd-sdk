import type {
  BackendAdapter,
  NavigationNode,
  PaginatedResponse,
  SearchFilters,
  SearchResult,
} from "../types";

/**
 * Media-level adapter that translates between Explorer UI paths
 * and b3nd URIs. Delegates all network operations to the provided client.
 *
 * The client can be a Rig's `.client` (ProtocolInterfaceNode), an HttpClient,
 * or any object with `list`, `read`, `getSchema`, and `health` methods.
 */

interface ClientLike {
  read(
    uri: string,
  ): Promise<
    { success: boolean; record?: { data: unknown }; error?: string }[]
  >;
  status(): Promise<{ status: string; schema?: string[] }>;
}

export class HttpAdapter implements BackendAdapter {
  name = "HTTP Backend";
  type = "http" as const;
  baseUrl: string;
  private client: ClientLike;

  constructor(client: ClientLike, baseUrl: string) {
    this.baseUrl = baseUrl;
    this.client = client;
  }

  /** Swap the underlying client (e.g. on backend switch). */
  setClient(client: ClientLike) {
    this.client = client;
  }

  async listPath(
    path: string,
    options?: { page?: number; limit?: number },
  ): Promise<PaginatedResponse<NavigationNode>> {
    // Root path should be handled by schema-driven navigation
    if (path === "/" || path === "") {
      throw new Error(
        "Root path should be handled by schema-driven navigation, not listPath",
      );
    }

    // Convert Explorer path format to URI: "/users/alice" -> "users://alice/"
    // Support protocol root: "/test/" -> "test://"
    const uri = this.pathToUri(path);

    // Use read with trailing slash for listing
    let listUri = uri;
    // Avoid breaking protocol roots like "test://" (would become "test:/")
    if (!listUri.endsWith("://") && !listUri.endsWith("/")) {
      listUri = listUri + "/";
    }
    const results = await this.client.read(listUri);
    const result = results[0];

    // Handle error response
    if (!result?.success) {
      throw new Error(
        `Failed to list ${path}: ${result?.error ?? "no result"}`,
      );
    }

    // Transform API response to Explorer format
    const data = result.record?.data;
    const items: any[] = Array.isArray(data) ? data : [];
    return {
      data: items.map((item: any) => {
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
      pagination: undefined,
    };
  }

  async readRecord(path: string): Promise<{ data: unknown }> {
    // Convert Explorer path to URI
    const uri = this.pathToUri(path);

    // Use sdk HttpClient to read
    const results = await this.client.read(uri);
    const result = results[0];

    if (!result?.success || !result.record) {
      throw new Error(`Record not found: ${path}`);
    }

    return result.record;
  }

  async searchPaths(
    _query: string,
    _filters?: SearchFilters,
    options?: { page?: number; limit?: number },
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
    const s = await this.client.status();
    return { default: s.schema ?? [] };
  }

  async healthCheck(): Promise<boolean> {
    const result = await this.client.status();
    return result.status === "healthy";
  }

  // Build a direct HTTP API read URL for a given explorer path
  getReadUrl(path: string): string {
    const uri = this.pathToUri(path);
    const url = new URL(uri);
    const protocol = url.protocol.replace(":", "");
    const domain = url.hostname;
    const recordPath = url.pathname;
    return `${this.baseUrl}/api/v1/read/${protocol}/${domain}${recordPath}`;
  }

  // Helper: Convert "/users/alice/profile" -> "users://alice/profile"
  private pathToUri(path: string): string {
    const parts = path.split("/").filter(Boolean);

    // Root path "/" should not be converted - this is handled by schema-driven navigation
    if (parts.length === 0) {
      throw new Error(
        "Cannot convert root path '/' to URI - use schema-driven navigation",
      );
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
