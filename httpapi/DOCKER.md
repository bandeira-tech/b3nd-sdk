# Docker Setup for b3nd HTTP API with PostgreSQL

This document describes how to run the b3nd HTTP API with PostgreSQL support using Docker.

## Quick Start

### Using Docker Compose (Recommended)

1. **Start the full stack** (PostgreSQL + HTTP API):
   ```bash
   cd httpapi
   docker-compose up -d
   ```

2. **Check status**:
   ```bash
   docker-compose ps
   docker-compose logs -f
   ```

3. **Test the API**:
   ```bash
   curl http://localhost:8000/api/v1/health
   ```

4. **Stop everything**:
   ```bash
   docker-compose down
   ```

### Using Docker Build

1. **Build the image**:
   ```bash
   docker build -t b3nd-httpapi .
   ```

2. **Run with PostgreSQL**:
   ```bash
   docker run -d \
     --name b3nd-httpapi \
     -p 8000:8000 \
     -e DATABASE_URL="postgresql://user:password@host:5432/database" \
     b3nd-httpapi
   ```

## Configuration

### Environment Variables

#### PostgreSQL Connection
- `DATABASE_URL` - Full PostgreSQL connection string (preferred)
  - Format: `postgresql://user:password@host:port/database`
  - Example: `postgresql://b3nd_user:b3nd_password@postgres:5432/b3nd_db`

#### Alternative PostgreSQL Configuration
Use these if you don't want to use `DATABASE_URL`:
- `POSTGRES_HOST` - PostgreSQL host (default: "localhost")
- `POSTGRES_PORT` - PostgreSQL port (default: "5432")
- `POSTGRES_DB` - Database name
- `POSTGRES_USER` - Database user
- `POSTGRES_PASSWORD` - Database password

#### PostgreSQL Advanced Options
- `POSTGRES_TABLE_PREFIX` - Table prefix for b3nd data (default: "b3nd")
- `POSTGRES_POOL_SIZE` - Connection pool size (default: "10")
- `POSTGRES_CONNECTION_TIMEOUT` - Connection timeout in ms (default: "30000")

#### API Configuration
- `API_PORT` - HTTP API port (default: "8000")
- `LOG_LEVEL` - Logging level: debug, info, warn, error (default: "info")
- `HEALTH_CHECK_INTERVAL` - Health check interval in ms (default: "60000")

#### B3ND Configuration
- `INSTANCES_CONFIG` - Path to instances configuration (default: "./config/instances.json")
- `SERVER_CONFIG` - Path to server configuration (default: "./config/server.json")

## Examples

### Development with Local PostgreSQL

1. **Start PostgreSQL locally**:
   ```bash
   # Using Docker for PostgreSQL
   docker run -d \
     --name postgres-dev \
     -e POSTGRES_DB=b3nd_dev \
     -e POSTGRES_USER=b3nd_user \
     -e POSTGRES_PASSWORD=b3nd_password \
     -p 5432:5432 \
     postgres:16-alpine
   ```

2. **Run HTTP API with local PostgreSQL**:
   ```bash
   cd httpapi
   export DATABASE_URL="postgresql://b3nd_user:b3nd_password@localhost:5432/b3nd_dev"
   deno task start:postgres
   ```

### Production Deployment

1. **Using Docker Compose with custom config**:
   ```yaml
   # docker-compose.prod.yml
   version: '3.8'
   services:
     postgres:
       image: postgres:16-alpine
       environment:
         POSTGRES_DB: ${POSTGRES_DB}
         POSTGRES_USER: ${POSTGRES_USER}
         POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
       volumes:
         - postgres_data:/var/lib/postgresql/data
       networks:
         - b3nd-network

     b3nd-httpapi:
       image: b3nd-httpapi:latest
       environment:
         DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
         LOG_LEVEL: warn
         HEALTH_CHECK_INTERVAL: 120000
       ports:
         - "8000:8000"
       depends_on:
         - postgres
       networks:
         - b3nd-network
       restart: always

   volumes:
     postgres_data:

   networks:
     b3nd-network:
       driver: bridge
   ```

2. **Deploy with environment file**:
   ```bash
   # Create .env file
   POSTGRES_DB=b3nd_prod
   POSTGRES_USER=b3nd_user
   POSTGRES_PASSWORD=your_secure_password

   # Deploy
   docker-compose -f docker-compose.prod.yml --env-file .env up -d
   ```

## Testing

### Health Check
```bash
# Check API health
curl http://localhost:8000/api/v1/health

# Check PostgreSQL connection (via API)
curl http://localhost:8000/api/v1/instances
```

### Basic Operations
```bash
# Write data
curl -X POST http://localhost:8000/api/v1/write \
  -H "Content-Type: application/json" \
  -d '{
    "uri": "users://test/user1",
    "value": {"name": "Test User", "email": "test@example.com"}
  }'

# Read data
curl "http://localhost:8000/api/v1/read?uri=users://test/user1"

# List data
curl "http://localhost:8000/api/v1/list?uri=users://test"
```

## Troubleshooting

### PostgreSQL Connection Issues

1. **Check PostgreSQL is running**:
   ```bash
   docker-compose logs postgres
   ```

2. **Verify connection string**:
   ```bash
   # Test connection manually
   docker exec -it b3nd-postgres psql -U b3nd_user -d b3nd_db -c "SELECT 1;"
   ```

3. **Check environment variables**:
   ```bash
   docker-compose exec b3nd-httpapi env | grep DATABASE
   ```

### API Issues

1. **Check API logs**:
   ```bash
   docker-compose logs b3nd-httpapi
   ```

2. **Verify health endpoint**:
   ```bash
   curl -v http://localhost:8000/api/v1/health
   ```

3. **Check registered instances**:
   ```bash
   curl http://localhost:8000/api/v1/instances
   ```

### Memory Issues

If PostgreSQL is unavailable, the API will fall back to memory clients:
```
[Setup] ⚠ Running with memory backend (PostgreSQL unavailable)
```

## Security Notes

- Always use strong passwords in production
- Consider using Docker secrets for sensitive data
- Use SSL/TLS for PostgreSQL connections in production
- Restrict network access to PostgreSQL
- Regular security updates for both PostgreSQL and the API

## Performance Tuning

### PostgreSQL
- Adjust `POSTGRES_POOL_SIZE` based on your workload
- Configure PostgreSQL memory settings appropriately
- Use connection pooling (built into the client)

### API
- Set appropriate `HEALTH_CHECK_INTERVAL`
- Use `LOG_LEVEL=warn` in production to reduce logging overhead
- Consider horizontal scaling with multiple API instances

## Data Persistence

The PostgreSQL data is persisted in a Docker volume (`postgres_data`). To backup or migrate data:

```bash
# Backup
docker exec b3nd-postgres pg_dump -U b3nd_user b3nd_db > backup.sql

# Restore
docker exec -i b3nd-postgres psql -U b3nd_user -d b3nd_db < backup.sql
```

## Migration from Memory to PostgreSQL

The API automatically detects PostgreSQL availability and uses it as the default backend when available. Memory clients remain available as fallback options. No data migration is performed automatically - you'll need to implement data migration scripts if needed.}

## Monitoring

The setup includes health checks for both PostgreSQL and the HTTP API. Monitor these endpoints:

- PostgreSQL: Built-in health check in docker-compose
- HTTP API: `http://localhost:8000/api/v1/health`
- Overall system: `docker-compose ps`