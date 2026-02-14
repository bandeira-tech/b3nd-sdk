FROM denoland/deno:2.5.6

WORKDIR /app

# Copy workspace-level files needed for resolution
COPY ./deno.json ./deno.lock /app/

# Copy SDK source (needed for imports)
COPY ./src/ /app/src/
COPY ./libs/b3nd-core/ /app/libs/b3nd-core/
COPY ./libs/b3nd-compose/ /app/libs/b3nd-compose/
COPY ./libs/b3nd-msg/ /app/libs/b3nd-msg/
COPY ./libs/b3nd-servers/ /app/libs/b3nd-servers/
COPY ./libs/b3nd-client-memory/ /app/libs/b3nd-client-memory/
COPY ./libs/b3nd-client-http/ /app/libs/b3nd-client-http/
COPY ./libs/b3nd-client-ws/ /app/libs/b3nd-client-ws/
COPY ./libs/b3nd-client-postgres/ /app/libs/b3nd-client-postgres/
COPY ./libs/b3nd-client-mongo/ /app/libs/b3nd-client-mongo/
COPY ./libs/b3nd-combinators/ /app/libs/b3nd-combinators/
COPY ./libs/b3nd-encrypt/ /app/libs/b3nd-encrypt/
COPY ./libs/b3nd-auth/ /app/libs/b3nd-auth/
COPY ./libs/b3nd-hash/ /app/libs/b3nd-hash/

# Copy the app
COPY ./apps/b3nd-node/ /app/apps/b3nd-node/

WORKDIR /app/apps/b3nd-node

# Cache dependencies
RUN deno cache ./mod.ts

EXPOSE 9942

CMD ["deno", "run", "-A", "./mod.ts"]
