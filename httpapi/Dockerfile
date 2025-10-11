# Production Dockerfile for b3nd HTTP API with PostgreSQL support
FROM denoland/deno:2.5.2

# Install PostgreSQL client libraries for potential native PostgreSQL support
RUN apt-get update && apt-get install -y \
    postgresql-client \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy the entire project to ensure SDK dependency resolution
COPY . .

# Set working directory to httpapi for proper config loading
WORKDIR /app/httpapi

# Set environment variables with defaults
ENV API_PORT=8000
ENV LOG_LEVEL=info
ENV HEALTH_CHECK_INTERVAL=60000

# PostgreSQL connection configuration
ENV DATABASE_URL=""
ENV POSTGRES_HOST=""
ENV POSTGRES_PORT="5432"
ENV POSTGRES_DB=""
ENV POSTGRES_USER=""
ENV POSTGRES_PASSWORD=""

# B3ND specific configuration (now relative to httpapi directory)
ENV INSTANCES_CONFIG="./config/instances.json"
ENV SERVER_CONFIG="./config/server.json"

# Expose the API port
EXPOSE 8000

# Install dependencies and build (as root to avoid permission issues)
RUN deno cache --unstable-kv src/main-postgres.ts src/server.ts src/mod.ts

# Create non-root user for security
RUN groupadd -r b3nd && useradd -r -g b3nd b3nd
RUN chown -R b3nd:b3nd /app
USER b3nd

# Health check (run from httpapi directory)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD deno run --allow-net --allow-env https://deno.land/x/deno_healthcheck@v1.0.0/mod.ts http://localhost:${API_PORT}/api/v1/health

# Start the HTTP API server with PostgreSQL support
CMD ["deno", "run", \
     "--allow-net", \
     "--allow-read", \
     "--allow-write", \
     "--allow-env", \
     "--unstable-kv", \
     "src/main-postgres.ts"]