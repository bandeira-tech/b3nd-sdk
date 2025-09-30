import { z } from "zod";
import type { PersistenceRecord, PersistenceWrite } from "../../persistence/mod.ts";

// HTTP Request Schemas

// Query params for list endpoint: GET /api/v1/list/:path
export const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  instance: z.string().optional().default("default"),
});

export type ListQuery = z.infer<typeof ListQuerySchema>;

// Params for read/delete: :path in URL
export const PathParamsSchema = z.object({
  path: z.string().min(1), // URL-decoded path
});

export type PathParams = z.infer<typeof PathParamsSchema>;

// Body for write: POST /api/v1/write
export const WriteBodySchema = z.object({
  uri: z.string().url(), // Full URI like "users://nataliarsand/profile"
  value: z.unknown(), // Generic value, validated later against schema
  instance: z.string().optional().default("default"),
});

export type WriteBody = z.infer<typeof WriteBodySchema>;

// Query for search: GET /api/v1/search
export const SearchQuerySchema = z.object({
  q: z.string().optional(),
  protocol: z.string().optional(),
  domain: z.string().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  instance: z.string().optional().default("default"),
});

export type SearchQuery = z.infer<typeof SearchQuerySchema>;

// HTTP Response Schemas

// Pagination info
export const PaginationSchema = z.object({
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
  total: z.number().int().min(0),
  hasNext: z.boolean(),
  hasPrev: z.boolean(),
});

export type Pagination = z.infer<typeof PaginationSchema>;

// Response for list: { data: NavigationNode[], pagination }
export const NavigationNodeSchema = z.object({
  uri: z.string().url(),  // Primary identifier (e.g., "users://alice/profile")
  type: z.enum(["file", "directory"]),
  // name removed - redundant with uri
  // ts removed - available via separate read operation
  // children removed - not included in list response (lazy-loaded via separate list call)
});

export const ListResponseSchema = z.object({
  data: z.array(NavigationNodeSchema),
  pagination: PaginationSchema,
});

export type ListResponse = z.infer<typeof ListResponseSchema>;

// Response for read: { ts: number, data: any }
export const ReadResponseSchema = z.object({
  ts: z.number().int(),
  data: z.unknown(),
});

export type ReadResponse = z.infer<typeof ReadResponseSchema> & PersistenceRecord<unknown>;

// Response for write: { success: boolean, record?: PersistenceRecord, error?: string }
export const WriteResponseSchema = z.object({
  success: z.boolean(),
  record: z
    .object({
      ts: z.number().int(),
      data: z.unknown(),
    })
    .optional(),
  error: z.string().optional(),
});

export type WriteResponse = z.infer<typeof WriteResponseSchema>;

// Generic success/error response
export const SuccessResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});

export type SuccessResponse = z.infer<typeof SuccessResponseSchema>;

// Search result (placeholder, extend as needed)
export const SearchResultSchema = z.object({
  uri: z.string().url(),
  snippet: z.string().optional(),
  score: z.number().optional(),
});

export const SearchResponseSchema = z.object({
  data: z.array(SearchResultSchema),
  pagination: PaginationSchema,
});

export type SearchResponse = z.infer<typeof SearchResponseSchema>;

// Error response
export const ErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// Schema endpoint response
export const SchemaResponseSchema = z.object({
  schemas: z.record(z.string(), z.unknown()),
});

export type SchemaResponse = z.infer<typeof SchemaResponseSchema>;

// Health response
export const HealthResponseSchema = z.object({
  status: z.literal("healthy"),
  instances: z.array(z.string()),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

// Extended Persistence Types for API

// API-specific write, mirroring PersistenceWrite but with instance
export type ApiPersistenceWrite<T> = PersistenceWrite<T> & {
  instance?: string;
};

// API-specific record with optional instance
export type ApiPersistenceRecord<T> = PersistenceRecord<T> & {
  instance?: string;
};

// Instance selection type
export type InstanceId = string;
