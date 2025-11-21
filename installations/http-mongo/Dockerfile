# Required at runtime:
#   - MONGODB_URL: MongoDB connection string
#   - MONGODB_DB: MongoDB database name
#   - MONGODB_COLLECTION: MongoDB collection name

FROM ghcr.io/bandeira-tech/b3nd/http-alpine:latest
CMD ["deno", "run", "-A", "installations/http-postgres/mod.ts"]
