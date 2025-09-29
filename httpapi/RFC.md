# b3nd/httpapi Implementation Plan

## Overview

b3nd/httpapi is a Deno-based HTTP server that provides a RESTful interface to b3nd/persistence instances. It enables client applications to perform read and write operations on persistence data through HTTP endpoints, supporting cross-domain requests via CORS. The server acts as a gateway, delegating operations to the underlying persistence layer while allowing for extensible middleware for access control and validation. By default, it exposes the core persistence operations without built-in authentication, facilitating development and integration testing.

The design prioritizes simplicity, type safety, and alignment with the b3nd/persistence API surface, ensuring that frontend adapters (like those in b3nd/explorer) can seamlessly switch between mock and HTTP backends.

## Architecture

### Core Layers

#### 1. HTTP Routing Layer
- **Framework**: Hono for lightweight, fast routing with middleware support.
- **Endpoints**: RESTful paths mirroring persistence operations (e.g., `GET /api/v1/list/:path`, `POST /api/v1/write`).
- **CORS**: Built-in support for cross-origin requests from any domain, configurable via middleware.

#### 2. Persistence Integration Layer
- **Adapter Pattern**: A server-side adapter that translates HTTP requests to b3nd/persistence method calls (e.g., `listPath`, `readRecord`, `write`).
- **Instance Management**: Support for multiple persistence instances, selected via query param or header (e.g., `?instance=default`).
- **Error Mapping**: HTTP status codes mapped to persistence errors (e.g., 404 for not found, 400 for validation failure).

#### 3. Middleware Layer
- **Request Validation**: Middleware for URL/path sanitization, payload schema validation using Zod.
- **Access Control Hooks**: Extensible points for custom middleware (e.g., API key validation, rate limiting) without default enforcement.
- **Logging and Metrics**: Optional middleware for request logging and performance metrics.

#### 4. Configuration Layer
- **Server Config**: Deno CLI flags for port, persistence config path, CORS origins.
- **Persistence Config**: JSON/YAML file defining instances (e.g., schema, storage backend like in-memory or file-based for dev).

### Data Flow

1. **Incoming Request**: Client sends HTTP request (e.g., `GET /api/v1/list/users/nataliarsand`).
2. **Routing**: Hono matches route, applies CORS and validation middleware.
3. **Adapter Translation**: Extracts path/options from URL/query, calls persistence `listPath`.
4. **Persistence Operation**: Executes on the selected instance, returns data or error.
5. **Response Serialization**: JSON response with data/pagination, HTTP status.
6. **Error Handling**: Maps persistence errors to HTTP responses (e.g., 500 for internal, 403 for auth if middleware added).

For writes (e.g., `POST /api/v1/write`): Deserialize JSON payload, validate against schema, call persistence `write`.

## Technical Stack

- **Runtime**: Deno 1.40+ for secure, TypeScript-native execution without Node.js dependencies.
- **Web Framework**: Hono for routing, middleware, and JSON handling.
- **Validation**: Zod for request/response schema validation.
- **Persistence Integration**: Direct import of b3nd/persistence types and classes.
- **Configuration**: Deno CLI + std/path for config file loading (JSON/YAML via dejs/yaml).
- **CORS**: Hono's built-in CORS middleware.
- **Testing**: Deno's built-in test runner with supertest-like HTTP testing.
- **TypeScript**: Full type safety with Deno's TS support, no separate compilation step.

## API Design

### Endpoints

#### Read Operations
- `GET /api/v1/list/:path*` – List contents at path (supports pagination via `?page=1&limit=50`).
  - Response: `{ data: NavigationNode[], pagination: { page, limit, total, hasNext, hasPrev } }` (200 OK).
- `GET /api/v1/read/:path` – Read record at exact path.
  - Response: `{ ts: number, data: any }` (200 OK).
- `GET /api/v1/search` – Search paths/content (POST body for complex queries, GET for simple).
  - Query: `?q=query&protocol=users&domain=nataliarsand&page=1&limit=20`.
  - Response: `{ data: SearchResult[], pagination: ... }` (200 OK).

#### Write Operations
- `POST /api/v1/write` – Write or update record.
  - Body: `{ uri: string, value: any }`.
  - Response: `{ success: boolean, record: PersistenceRecord | null, error?: string }` (200/201 OK or 400/500).
- `DELETE /api/v1/delete/:path` – Delete record at path.
  - Response: `{ success: boolean, error?: string }` (200 OK or 404/500).

#### Metadata
- `GET /api/v1/schema` – Get persistence schema.
  - Response: `{ schemas: Record<string, any> }` (200 OK).
- `GET /api/v1/health` – Health check for instances.
  - Response: `{ status: 'healthy', instances: string[] }` (200 OK).

### Request/Response Formats
- All requests/responses in JSON.
- Paths URL-encoded for special characters.
- Pagination consistent across list/search.
- Errors: `{ error: string, code: string }` with HTTP status.

### Extensibility
- Middleware chain: `app.use('*', corsMiddleware)` → `app.use('*', validationMiddleware)` → route handlers.
- Custom routes: Mount at `/api/v1/custom` for app-specific endpoints.
- Instance selection: Header `X-Persistence-Instance: default` or query `?instance=default`.

## Component Architecture

### Server Entry Point
- `mod.ts`: Main Deno entry, loads config, initializes Hono app, starts server on port 8000.

### Core Modules
- `routes.ts`: Defines all API routes, maps to adapter methods.
- `adapter.ts`: Server-side PersistenceAdapter implementing BackendAdapter interface, wraps b3nd/persistence.
- `config.ts`: Loads/validates server and persistence configs from file.
- `middleware.ts`: CORS, validation, logging middleware definitions.

### Utility Modules
- `types.ts`: Extends b3nd/persistence types for HTTP-specific (e.g., Request/Response schemas).
- `errors.ts`: Custom error classes for API (e.g., NotFoundError, ValidationError).
- `utils.ts`: Path sanitization, pagination helpers.

## Data Flow and State Management

### Request Processing
```
Client Request → Hono Router → Middleware (CORS/Validation) → Adapter → Persistence Operation → JSON Response
```

- Adapter receives HTTP params/body, converts to persistence args (e.g., path from URL, value from body).
- Persistence returns typed data; adapter serializes to JSON with HTTP headers.
- Errors bubble through middleware for consistent formatting.

### Instance Management
- Config defines instances (e.g., `{ "default": { schema: "./schema.json", storage: "memory" } }`).
- Adapter selects instance by ID, delegates calls.
- Supports in-memory for dev, extensible to file/Redis via persistence constructors.

## Implementation Phases

### Phase 1: Foundation
1. **Project Setup**: Deno project with Hono, Zod, config loading.
2. **Basic Server**: Hono app with CORS middleware, health/schema endpoints.
3. **Config System**: Load persistence instances from JSON/YAML.

### Phase 2: Core API
1. **Read Endpoints**: Implement listPath, readRecord, searchPaths routes.
2. **Adapter Layer**: Translate HTTP to persistence calls, handle pagination/errors.
3. **Write Endpoints**: Implement write, delete with validation.

### Phase 3: Extensibility and Testing
1. **Middleware Framework**: Add validation/logging hooks, example access control.
2. **Instance Routing**: Support multiple persistence instances via header/query.
3. **Testing Suite**: Unit tests for adapter/routes, integration tests with mock persistence.

### Phase 4: Documentation and Polish
1. **API Docs**: OpenAPI/Swagger spec generation.
2. **Error Responses**: Standardized error format.
3. **Deployment Config**: Deno deploy compatibility, environment variables.

## Key Technical Decisions

### 1. Runtime Choice
Deno selected for native TypeScript, secure permissions, and no package manager complexity. Hono provides lightweight routing without Express-like overhead.

### 2. API Surface Alignment
Endpoints mirror frontend adapter interface for seamless switching (e.g., explorer HTTP backend uses same types/methods). This ensures consistency across mock/HTTP implementations.

### 3. Persistence Integration
Direct use of b3nd/persistence classes in adapter, with config-driven instance creation. Supports multiple backends (memory, file) via persistence constructors, allowing dev/prod flexibility.

### 4. Access Control Design
No default auth to keep core simple; middleware hooks allow injection (e.g., API keys, JWT). Decisions for production: header-based keys or OAuth integration points.

### 5. Error and Validation Strategy
Zod for request validation (e.g., path strings, JSON payloads). Persistence errors mapped to HTTP (400 for invalid, 404 for not found, 500 for internal). Extensible via custom error middleware.

### 6. Cross-Domain Support
Hono CORS middleware configured for all origins by default (dev-friendly), with config for production restrictions. Pre-flight handling for complex requests.

### 7. Configuration Format
JSON/YAML for server/persistence config, loaded at startup. Supports environment overrides for secrets (e.g., port, instance paths).

## File Structure
```
src/
├── mod.ts                 # Entry point, server startup
├── routes.ts              # API route definitions
├── adapter.ts             # HTTP to persistence translation
├── config.ts              # Config loading and validation
├── middleware/
│   ├── cors.ts            # CORS configuration
│   ├── validation.ts      # Zod schemas for requests
│   └── logging.ts         # Request/response logging
├── types.ts               # HTTP-specific types
├── errors.ts              # Custom API errors
└── utils.ts               # Helpers (path utils, serialization)
tests/
├── adapter.test.ts        # Adapter unit tests
└── routes.test.ts         # End-to-end route tests
config/
├── server.json            # Server config (port, CORS)
└── persistence.json       # Instance definitions
deno.json                  # Deno config (imports, tasks)
```
