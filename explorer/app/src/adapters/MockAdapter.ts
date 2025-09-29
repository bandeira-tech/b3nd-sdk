import type {
  BackendAdapter,
  PersistenceRecord,
  NavigationNode,
  SearchResult,
  SearchFilters,
  PaginatedResponse,
} from "../types";
import {
  mockPersistenceData,
  generateMockNavigationTree,
  mockSchema,
} from "../fixtures/mock-data";
import { parsePathSegments, sanitizePath } from "../utils";

export class MockAdapter implements BackendAdapter {
  name = "Mock Backend";
  type = "mock" as const;
  private navigationTree = generateMockNavigationTree();

  // Simulate realistic network delays
  private async delay(ms: number = 200): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async listPath(
    path: string,
    options?: { page?: number; limit?: number },
  ): Promise<PaginatedResponse<NavigationNode>> {
    console.log(
      "MockAdapter listPath called with path:",
      path,
      "options:",
      options,
    ); // Debug
    await this.delay();

    const sanitizedPath = sanitizePath(path);
    const page = options?.page || 1;
    const limit = options?.limit || 50;

    // Find the node at the given path
    const node = this.findNodeByPath(sanitizedPath);
    console.log(
      "MockAdapter listPath found node for",
      sanitizedPath,
      ":",
      node ? node.name : "null",
    ); // Debug

    if (!node) {
      throw new Error(`Path not found: ${sanitizedPath}`);
    }

    if (node.type === "file") {
      // Return the file itself as a single-item list
      return {
        data: [node],
        pagination: {
          page: 1,
          limit,
          total: 1,
          hasNext: false,
          hasPrev: false,
        },
      };
    }

    // For directories, return children with pagination
    const children = node.children || [];
    console.log(
      "MockAdapter listPath children for",
      sanitizedPath,
      ":",
      children.map((c) => ({ name: c.name, type: c.type })),
    ); // Debug
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedChildren = children.slice(startIndex, endIndex);

    return {
      data: paginatedChildren,
      pagination: {
        page,
        limit,
        total: children.length,
        hasNext: endIndex < children.length,
        hasPrev: startIndex > 0,
      },
    };
  }

  async readRecord(path: string): Promise<PersistenceRecord> {
    await this.delay(100);

    const sanitizedPath = sanitizePath(path);
    const record = mockPersistenceData[sanitizedPath];

    if (!record) {
      throw new Error(`Record not found: ${sanitizedPath}`);
    }

    return record;
  }

  async searchPaths(
    query: string,
    filters?: SearchFilters,
    options?: { page?: number; limit?: number },
  ): Promise<PaginatedResponse<SearchResult>> {
    await this.delay(300);

    const page = options?.page || 1;
    const limit = options?.limit || 20;

    // Simple search implementation
    const results: SearchResult[] = [];
    const queryLower = query.toLowerCase();

    for (const [path, record] of Object.entries(mockPersistenceData)) {
      // Apply filters
      if (filters?.protocol) {
        const protocol = path.startsWith("/users") ? "users" : "apps";
        if (protocol !== filters.protocol) continue;
      }

      if (filters?.domain) {
        const segments = parsePathSegments(path);
        if (segments.length < 2 || segments[1] !== filters.domain) continue;
      }

      if (filters?.pathPattern) {
        const pattern = new RegExp(filters.pathPattern, "i");
        if (!pattern.test(path)) continue;
      }

      if (filters?.dateRange) {
        if (
          record.ts < filters.dateRange.start.getTime() ||
          record.ts > filters.dateRange.end.getTime()
        )
          continue;
      }

      // Search in path and data
      let matches = false;
      let snippet = "";

      if (path.toLowerCase().includes(queryLower)) {
        matches = true;
        snippet = `Path: ${path}`;
      }

      // Search in data content
      const dataStr = JSON.stringify(record.data).toLowerCase();
      if (dataStr.includes(queryLower)) {
        matches = true;

        // Create snippet from data
        const dataJson = JSON.stringify(record.data, null, 2);
        const lines = dataJson.split("\n");
        const matchingLine = lines.find((line) =>
          line.toLowerCase().includes(queryLower),
        );
        snippet = matchingLine
          ? matchingLine.trim()
          : dataStr.substring(0, 100) + "...";
      }

      if (matches) {
        const segments = parsePathSegments(path);
        results.push({
          path,
          name: segments[segments.length - 1] || path,
          record,
          snippet,
        });
      }
    }

    // Sort by relevance (path matches first, then by timestamp)
    results.sort((a, b) => {
      const aPathMatch = a.path.toLowerCase().includes(queryLower);
      const bPathMatch = b.path.toLowerCase().includes(queryLower);

      if (aPathMatch && !bPathMatch) return -1;
      if (!aPathMatch && bPathMatch) return 1;

      return b.record.ts - a.record.ts;
    });

    // Apply pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedResults = results.slice(startIndex, endIndex);

    return {
      data: paginatedResults,
      pagination: {
        page,
        limit,
        total: results.length,
        hasNext: endIndex < results.length,
        hasPrev: startIndex > 0,
      },
    };
  }

  async getSchema(): Promise<Record<string, any>> {
    await this.delay(100);
    return mockSchema;
  }

  async healthCheck(): Promise<boolean> {
    await this.delay(50);
    return true;
  }

  private findNodeByPath(path: string): NavigationNode | null {
    console.log(
      "MockAdapter findNodeByPath called with path:",
      path,
      "segments:",
      parsePathSegments(path),
    ); // Debug
    const segments = parsePathSegments(path);

    if (segments.length === 0) {
      // Root path - return virtual root with top-level protocols
      return {
        path: "/",
        name: "root",
        type: "directory",
        children: this.navigationTree,
      };
    }

    let current: NavigationNode | null = null;
    let children = this.navigationTree;

    for (const segment of segments) {
      current = children.find((node) => node.name === segment) || null;
      console.log(
        "MockAdapter findNodeByPath segment",
        segment,
        "current:",
        current ? current.name : "null",
      ); // Debug
      if (!current) return null;
      children = current.children || [];
    }

    console.log(
      "MockAdapter findNodeByPath final current:",
      current ? current.name : "null",
    ); // Debug
    return current;
  }
}
