FROM denoland/deno:1.40.0

WORKDIR /app

# Copy dependency files first for better caching
COPY deno.json .
COPY deno.lock* .

# Cache dependencies
RUN deno cache --reload mod.ts || true

# Copy the rest of the application
COPY . .

# Cache all dependencies
RUN deno cache mod.ts

# Expose the default port
EXPOSE 8843

# Run the server
CMD ["run", "--allow-net", "--allow-read", "--allow-env", "mod.ts"]
