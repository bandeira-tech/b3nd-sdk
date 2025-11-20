FROM ghcr.io/bandeira-tech/b3nd/http-alpine:latest

WORKDIR /app

COPY sdk ./sdk
COPY installations/http-mongo ./installations/http-mongo

EXPOSE 8080

ENV PORT=8080
ENV SCHEMA_MODULE=/app/installations/http-mongo/example-schema.ts

# Required at runtime:
#   - MONGODB_URL: MongoDB connection string
#   - MONGODB_DB: MongoDB database name
#   - MONGODB_COLLECTION: MongoDB collection name

CMD ["deno", "run", "--config", "installations/http-mongo/deno.json", "-A", "installations/http-mongo/mod.ts"]
