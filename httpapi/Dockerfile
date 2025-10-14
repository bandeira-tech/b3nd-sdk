# Base Dockerfile for b3nd HTTP API
# This provides the core application that can be extended by installations

FROM denoland/deno:2.5.2

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

# B3ND specific configuration (relative to httpapi directory)
ENV INSTANCES_CONFIG="./config/instances.json"
ENV SERVER_CONFIG="./config/server.json"

# Expose the API port
EXPOSE 8000

# Create non-root user for security
RUN groupadd -r b3nd && useradd -r -g b3nd b3nd
RUN chown -R b3nd:b3nd /app
USER b3nd

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD deno run --allow-net --allow-env https://deno.land/x/deno_healthcheck@v1.0.0/mod.ts http://localhost:${API_PORT}/api/v1/health

# Install dependencies and build
RUN deno cache --unstable-kv src/server.ts src/mod.ts

# Default command (can be overridden by installations)
CMD ["deno", "run", \
     "--allow-net", \
     "--allow-read", \
     "--allow-write", \
     "--allow-env", \
     "--unstable-kv", \
     "src/server.ts"]