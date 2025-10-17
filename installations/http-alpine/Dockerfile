FROM ghcr.io/bandeira-tech/b3nd/alpine:latest

RUN apt-get update && apt-get install -y curl

ENV PORT=8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:$PORT/api/v1/health || exit 1
