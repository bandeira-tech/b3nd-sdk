FROM ghcr.io/bandeira-tech/b3nd-alpine:latest

WORKDIR /app

COPY sdk/deno.json ./sdk/deno.json

COPY sdk ./sdk
COPY installations/http-postgres-node ./installations/http-postgres-node

EXPOSE 8080

ENV PORT=8080
ENV SCHEMA_MODULE=/app/installations/http-postgres-node/example-schema.ts

# Required at runtime:
#   - DATABASE_URL: PostgreSQL connection string

CMD ["deno", "run", "-A", "installations/http-postgres-node/mod.ts"]
