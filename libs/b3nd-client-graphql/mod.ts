/**
 * GraphQLClient - GraphQL implementation of NodeProtocolInterface
 *
 * Connects to B3nd GraphQL API servers and forwards operations via
 * an executor pattern. A default fetch-based executor is provided
 * when no custom executor is supplied.
 */

import type {
  DeleteResult,
  HealthStatus,
  ListOptions,
  ListResult,
  Message,
  NodeProtocolInterface,
  ReadMultiResult,
  ReadResult,
  ReceiveResult,
  Schema,
  ValidationFn,
} from "../b3nd-core/types.ts";
import { Errors } from "../b3nd-core/types.ts";

/**
 * Result shape returned by GraphQL execution.
 */
export interface GraphQLExecutorResult {
  data?: unknown;
  errors?: Array<{ message: string }>;
}

/**
 * Executor interface for GraphQL operations.
 * Implementations send a GraphQL query/mutation and return the result.
 */
export interface GraphQLExecutor {
  execute: (
    query: string,
    variables?: Record<string, unknown>,
  ) => Promise<GraphQLExecutorResult>;
  cleanup?: () => Promise<void>;
}

/**
 * Configuration for GraphQLClient.
 */
export interface GraphQLClientConfig {
  /** GraphQL endpoint URL */
  url: string;
  /** Optional custom headers (e.g., auth tokens) */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Optional schema for local validation */
  schema?: Schema;
}

/**
 * Validate schema key format.
 * Keys must be in format: "protocol://hostname"
 */
function validateSchemaKey(key: string): boolean {
  return /^[a-z]+:\/\/[a-z0-9-]+$/.test(key);
}

/**
 * Create a default fetch-based GraphQL executor.
 */
function createFetchExecutor(
  url: string,
  headers: Record<string, string>,
  timeout: number,
): GraphQLExecutor {
  return {
    execute: async (
      query: string,
      variables?: Record<string, unknown>,
    ): Promise<GraphQLExecutorResult> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
          body: JSON.stringify({ query, variables }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const text = await response.text().catch(() => response.statusText);
          return {
            errors: [{ message: `HTTP ${response.status}: ${text}` }],
          };
        }

        return await response.json();
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return {
            errors: [{ message: `Request timeout after ${timeout}ms` }],
          };
        }
        return {
          errors: [{
            message: error instanceof Error ? error.message : String(error),
          }],
        };
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}

// -- GraphQL query/mutation strings --

const RECEIVE_MUTATION = `mutation B3ndReceive($uri: String!, $data: JSON!) {
  b3ndReceive(uri: $uri, data: $data) {
    accepted
    error
  }
}`;

const READ_QUERY = `query B3ndRead($uri: String!) {
  b3ndRead(uri: $uri) {
    success
    record {
      ts
      data
    }
    error
  }
}`;

const READ_MULTI_QUERY = `query B3ndReadMulti($uris: [String!]!) {
  b3ndReadMulti(uris: $uris) {
    success
    results {
      uri
      success
      record {
        ts
        data
      }
      error
    }
    summary {
      total
      succeeded
      failed
    }
  }
}`;

const LIST_QUERY = `query B3ndList($uri: String!, $options: ListOptionsInput) {
  b3ndList(uri: $uri, options: $options) {
    success
    data {
      uri
    }
    pagination {
      page
      limit
      total
    }
    error
  }
}`;

const DELETE_MUTATION = `mutation B3ndDelete($uri: String!) {
  b3ndDelete(uri: $uri) {
    success
    error
  }
}`;

const HEALTH_QUERY = `query B3ndHealth {
  b3ndHealth {
    status
    message
    details
  }
}`;

const SCHEMA_QUERY = `query B3ndSchema {
  b3ndSchema
}`;

/**
 * Extract the first GraphQL error message, or return a fallback.
 */
function extractError(
  errors: Array<{ message: string }> | undefined,
  fallback: string,
): string {
  if (errors && errors.length > 0) {
    return errors[0].message;
  }
  return fallback;
}

export class GraphQLClient implements NodeProtocolInterface {
  private executor: GraphQLExecutor;
  private schema: Schema;

  constructor(config: GraphQLClientConfig, executor?: GraphQLExecutor) {
    // Validate schema keys
    if (config.schema) {
      const invalidKeys = Object.keys(config.schema).filter(
        (key) => !validateSchemaKey(key),
      );
      if (invalidKeys.length > 0) {
        throw new Error(
          `Invalid schema key format: ${
            invalidKeys.map((k) => `"${k}"`).join(", ")
          }. ` +
            `Keys must be in "protocol://hostname" format (e.g., "mutable://accounts", "immutable://data").`,
        );
      }
    }

    this.schema = config.schema || {};
    this.executor = executor ||
      createFetchExecutor(
        config.url,
        config.headers || {},
        config.timeout || 30000,
      );
  }

  async receive<D = unknown>(msg: Message<D>): Promise<ReceiveResult> {
    const [uri, data] = msg;

    // Basic URI validation
    if (!uri || typeof uri !== "string") {
      return { accepted: false, error: "Message URI is required" };
    }

    let parsed: URL | null;
    try {
      parsed = new URL(uri);
    } catch {
      return {
        accepted: false,
        error: "Invalid URI format",
        errorDetail: Errors.invalidUri(uri),
      };
    }

    const program = `${parsed.protocol}//${parsed.hostname}`;

    // Local schema validation if schema is provided
    if (Object.keys(this.schema).length > 0) {
      const validator: ValidationFn | undefined = this.schema[program];
      if (!validator) {
        return {
          accepted: false,
          error: "Program not found",
          errorDetail: Errors.invalidSchema(uri, "Unknown program"),
        };
      }

      const validation = await validator({
        uri,
        value: data,
        read: this.read.bind(this),
      });
      if (!validation.valid) {
        return {
          accepted: false,
          error: validation.error || "Validation failed",
          errorDetail: Errors.invalidSchema(uri, validation.error),
        };
      }
    }

    try {
      const result = await this.executor.execute(RECEIVE_MUTATION, {
        uri,
        data,
      });

      if (result.errors) {
        return {
          accepted: false,
          error: extractError(result.errors, "GraphQL mutation failed"),
        };
      }

      // deno-lint-ignore no-explicit-any
      const payload = (result.data as any)?.b3ndReceive;
      if (!payload) {
        return { accepted: false, error: "Unexpected response format" };
      }

      return {
        accepted: payload.accepted ?? false,
        error: payload.error,
      };
    } catch (error) {
      return {
        accepted: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async read<T = unknown>(uri: string): Promise<ReadResult<T>> {
    if (!uri || typeof uri !== "string") {
      return {
        success: false,
        error: "URI is required",
        errorDetail: Errors.invalidUri(uri || ""),
      };
    }

    try {
      const result = await this.executor.execute(READ_QUERY, { uri });

      if (result.errors) {
        return {
          success: false,
          error: extractError(result.errors, "GraphQL query failed"),
        };
      }

      // deno-lint-ignore no-explicit-any
      const payload = (result.data as any)?.b3ndRead;
      if (!payload) {
        return { success: false, error: "Unexpected response format" };
      }

      return payload as ReadResult<T>;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async readMulti<T = unknown>(uris: string[]): Promise<ReadMultiResult<T>> {
    if (uris.length === 0) {
      return {
        success: false,
        results: [],
        summary: { total: 0, succeeded: 0, failed: 0 },
      };
    }

    if (uris.length > 50) {
      return {
        success: false,
        results: [],
        summary: { total: uris.length, succeeded: 0, failed: uris.length },
      };
    }

    try {
      const result = await this.executor.execute(READ_MULTI_QUERY, { uris });

      if (result.errors) {
        return {
          success: false,
          results: uris.map((u) => ({
            uri: u,
            success: false as const,
            error: extractError(result.errors, "GraphQL query failed"),
          })),
          summary: { total: uris.length, succeeded: 0, failed: uris.length },
        };
      }

      // deno-lint-ignore no-explicit-any
      const payload = (result.data as any)?.b3ndReadMulti;
      if (!payload) {
        return {
          success: false,
          results: [],
          summary: { total: uris.length, succeeded: 0, failed: uris.length },
        };
      }

      return payload as ReadMultiResult<T>;
    } catch (error) {
      return {
        success: false,
        results: uris.map((u) => ({
          uri: u,
          success: false as const,
          error: error instanceof Error ? error.message : String(error),
        })),
        summary: { total: uris.length, succeeded: 0, failed: uris.length },
      };
    }
  }

  async list(uri: string, options?: ListOptions): Promise<ListResult> {
    try {
      const variables: Record<string, unknown> = { uri };
      if (options) {
        variables.options = options;
      }

      const result = await this.executor.execute(LIST_QUERY, variables);

      if (result.errors) {
        return {
          success: false,
          error: extractError(result.errors, "GraphQL query failed"),
        };
      }

      // deno-lint-ignore no-explicit-any
      const payload = (result.data as any)?.b3ndList;
      if (!payload) {
        return { success: false, error: "Unexpected response format" };
      }

      return payload as ListResult;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async delete(uri: string): Promise<DeleteResult> {
    try {
      const result = await this.executor.execute(DELETE_MUTATION, { uri });

      if (result.errors) {
        return {
          success: false,
          error: extractError(result.errors, "GraphQL mutation failed"),
        };
      }

      // deno-lint-ignore no-explicit-any
      const payload = (result.data as any)?.b3ndDelete;
      if (!payload) {
        return { success: false, error: "Unexpected response format" };
      }

      return payload as DeleteResult;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async health(): Promise<HealthStatus> {
    try {
      const result = await this.executor.execute(HEALTH_QUERY);

      if (result.errors) {
        return {
          status: "unhealthy",
          message: extractError(result.errors, "Health check failed"),
        };
      }

      // deno-lint-ignore no-explicit-any
      const payload = (result.data as any)?.b3ndHealth;
      if (!payload) {
        return { status: "unhealthy", message: "Unexpected response format" };
      }

      return payload as HealthStatus;
    } catch (error) {
      return {
        status: "unhealthy",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getSchema(): Promise<string[]> {
    try {
      const result = await this.executor.execute(SCHEMA_QUERY);

      if (result.errors) {
        return [];
      }

      // deno-lint-ignore no-explicit-any
      const payload = (result.data as any)?.b3ndSchema;
      if (!payload || !Array.isArray(payload)) {
        return [];
      }

      return payload;
    } catch {
      return [];
    }
  }

  async cleanup(): Promise<void> {
    if (this.executor.cleanup) {
      await this.executor.cleanup();
    }
  }
}
