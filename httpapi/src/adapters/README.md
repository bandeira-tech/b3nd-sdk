# Persistence Adapters

The HTTP API server uses a modular adapter system for persistence, allowing you to configure multiple instances with different storage backends and schemas.

## Architecture

The adapter system provides a pluggable architecture where each instance can use a different persistence strategy:

```
HTTP API Server
    ↓
AdapterManager (manages multiple instances)
    ↓
Adapter Instances (local-evergreen, local-denokv, websocket, etc.)
    ↓
Storage Backend (memory, Deno KV, remote server, etc.)
```

## Available Adapters

### 1. Local Evergreen (`local-evergreen`)

**Description**: In-memory storage that starts fresh on each server restart. All data is ephemeral.

**Use Cases**:
- Development and testing
- Temporary data that doesn't need persistence
- High-performance caching

**Configuration**:
```json
{
  "adapter": "@adapters/local-evergreen",
  "config": {
    "type": "local-evergreen",
    "schema": "./config/schemas/default.json",
    "options": {
      "type": "memory",
      "maxSize": 104857600  // Optional: max storage in bytes
    }
  }
}
```

### 2. Local Deno KV (`local-denokv`)

**Description**: Persistent storage using Deno's built-in KV database. Data survives server restarts.

**Use Cases**:
- Local development with persistence
- Small to medium-scale production deployments
- Applications requiring ACID transactions

**Configuration**:
```json
{
  "adapter": "@adapters/local-denokv",
  "config": {
    "type": "local-denokv",
    "schema": "./config/schemas/default.json",
    "options": {
      "type": "denokv",
      "path": "./data/persistent.db",
      "persistent": true,
      "autoSaveInterval": 30000  // Auto-save every 30 seconds
    }
  }
}
```

### 3. WebSocket (`websocket`)

**Description**: Connects to a remote persistence server via WebSocket for distributed deployments.

**Use Cases**:
- Distributed systems
- Microservices architecture
- Separation of API and storage layers

**Configuration**:
```json
{
  "adapter": "@adapters/websocket",
  "config": {
    "type": "websocket",
    "schema": "./config/schemas/default.json",
    "options": {
      "url": "ws://persistence-server:8080/ws",
      "auth": {
        "type": "bearer",
        "token": "${PERSISTENCE_API_TOKEN}"
      },
      "reconnect": {
        "enabled": true,
        "maxAttempts": 10,
        "interval": 5000,
        "backoff": "exponential"
      },
      "timeout": 30000,
      "compression": true
    }
  }
}
```

## Configuration

### Instances Configuration File

The main configuration file (`config/instances.json`) defines all available instances:

```json
{
  "default": "primary",  // Optional: default instance name
  "instances": {
    "primary": {
      "adapter": "@adapters/local-denokv",
      "config": { /* adapter configuration */ }
    },
    "cache": {
      "adapter": "@adapters/local-evergreen",
      "config": { /* adapter configuration */ }
    },
    "remote": {
      "adapter": "@adapters/websocket",
      "config": { /* adapter configuration */ }
    }
  }
}
```

### Schema Configuration

Schemas define validation rules for data writes. They can be:

#### JSON Schema (Simple Boolean Rules)
```json
{
  "public": true,     // Allow all writes
  "private": false,   // Deny all writes
  "user": true,
  "admin": false
}
```

#### TypeScript Schema (Advanced Validation)
```typescript
import type { PersistenceValidationFn } from "../../persistence/mod.ts";

export const user: PersistenceValidationFn<unknown> = async (write) => {
  const value = write.value as any;
  
  // Validate user object
  if (!value.id || typeof value.id !== 'string') {
    return false;
  }
  
  // Check permissions, data format, etc.
  return true;
};

export default { user };
```

## Creating Custom Adapters

To create a custom adapter, implement the `PersistenceAdapter` interface:

```typescript
import { BaseAdapter, type AdapterConfig } from "./types.ts";

export class CustomAdapter extends BaseAdapter {
  protected async doInitialize(): Promise<void> {
    // Initialize your storage backend
  }

  async write(protocol: string, domain: string, path: string, value: unknown) {
    // Implement write logic
  }

  async read(protocol: string, domain: string, path: string) {
    // Implement read logic
  }

  async listPath(protocol: string, domain: string, path: string, options?) {
    // Implement listing logic
  }

  async delete(protocol: string, domain: string, path: string) {
    // Implement delete logic
  }

  async cleanup(): Promise<void> {
    // Clean up resources
  }
}

// Export factory function
export default async function createCustomAdapter(config: AdapterConfig) {
  const adapter = new CustomAdapter();
  await adapter.initialize(config);
  return adapter;
}
```

## API Usage

### Using Specific Instances

```bash
# Write to default instance
curl -X POST http://localhost:8000/api/v1/write \
  -H "Content-Type: application/json" \
  -d '{"uri": "test://example/data", "value": {"message": "Hello"}}'

# Write to specific instance
curl -X POST http://localhost:8000/api/v1/write?instance=cache \
  -H "Content-Type: application/json" \
  -d '{"uri": "test://example/data", "value": {"message": "Hello"}}'

# Read from specific instance
curl http://localhost:8000/api/v1/read/cache/test/example/data
```

### Health Checks

```bash
# Check health of all instances
curl http://localhost:8000/api/v1/health
```

Response:
```json
{
  "status": "healthy",
  "instances": {
    "primary": {
      "status": "healthy",
      "message": "Adapter is operational",
      "lastCheck": 1234567890
    },
    "cache": {
      "status": "healthy",
      "message": "Adapter is operational",
      "lastCheck": 1234567890
    }
  },
  "timestamp": 1234567890
}
```

## Environment Variables

- `INSTANCES_CONFIG`: Path to instances configuration file (default: `./config/instances.json`)
- `LOG_LEVEL`: Logging level - debug, info, warn, error (default: `info`)
- `HEALTH_CHECK_INTERVAL`: Interval for health checks in ms (default: `60000`)

## Best Practices

1. **Use appropriate adapters for your use case**:
   - Development: `local-evergreen` for speed
   - Production: `local-denokv` or `websocket` for persistence
   - Caching: `local-evergreen` with TTL logic

2. **Configure schemas properly**:
   - Use TypeScript schemas for complex validation
   - Keep JSON schemas for simple allow/deny rules

3. **Monitor health endpoints**:
   - Set up monitoring for `/api/v1/health`
   - Configure alerts for degraded instances

4. **Handle instance failures gracefully**:
   - Implement fallback strategies
   - Use multiple instances for redundancy

5. **Secure sensitive data**:
   - Use encryption adapters for sensitive data
   - Implement authentication in schemas
   - Rotate API tokens regularly

## Migration Guide

### From Old Single-Instance System

1. Create `config/instances.json`:
```json
{
  "default": "default",
  "instances": {
    "default": {
      "adapter": "@adapters/local-evergreen",
      "config": {
        "type": "local-evergreen",
        "schema": "./config/schemas/default.json"
      }
    }
  }
}
```

2. Move schema to `config/schemas/default.json`

3. Update server startup to use `src/server.ts`

4. Test with existing API calls (they'll use the default instance)

## Troubleshooting

### Instance not found
- Check `config/instances.json` exists and is valid JSON
- Verify instance name in API calls matches configuration

### Schema validation failures
- Check schema file path is correct
- For TypeScript schemas, ensure proper export format
- Enable debug logging: `LOG_LEVEL=debug deno task start`

### WebSocket connection issues
- Verify WebSocket server is running
- Check authentication credentials
- Review reconnection settings

### Memory issues with local-evergreen
- Set `maxSize` limit in configuration
- Implement data expiration logic
- Consider using `local-denokv` for larger datasets