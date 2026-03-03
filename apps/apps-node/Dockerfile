FROM denoland/deno:2.5.6

WORKDIR /app

# Copy workspace-level files needed for resolution
COPY ./deno.json ./deno.lock /app/

# Copy SDK source (needed for imports)
COPY ./src/ /app/src/

# Copy all workspace libs (Deno requires every workspace member to exist)
COPY ./libs/b3nd-core/ /app/libs/b3nd-core/
COPY ./libs/b3nd-compose/ /app/libs/b3nd-compose/
COPY ./libs/b3nd-msg/ /app/libs/b3nd-msg/
COPY ./libs/b3nd-servers/ /app/libs/b3nd-servers/
COPY ./libs/b3nd-client-memory/ /app/libs/b3nd-client-memory/
COPY ./libs/b3nd-client-http/ /app/libs/b3nd-client-http/
COPY ./libs/b3nd-client-ws/ /app/libs/b3nd-client-ws/
COPY ./libs/b3nd-client-postgres/ /app/libs/b3nd-client-postgres/
COPY ./libs/b3nd-client-mongo/ /app/libs/b3nd-client-mongo/
COPY ./libs/b3nd-client-indexeddb/ /app/libs/b3nd-client-indexeddb/
COPY ./libs/b3nd-client-localstorage/ /app/libs/b3nd-client-localstorage/
COPY ./libs/b3nd-combinators/ /app/libs/b3nd-combinators/
COPY ./libs/b3nd-testing/ /app/libs/b3nd-testing/
COPY ./libs/b3nd-encrypt/ /app/libs/b3nd-encrypt/
COPY ./libs/b3nd-auth/ /app/libs/b3nd-auth/
COPY ./libs/b3nd-hash/ /app/libs/b3nd-hash/
COPY ./libs/b3nd-listener/ /app/libs/b3nd-listener/
COPY ./libs/b3nd-wallet/ /app/libs/b3nd-wallet/
COPY ./libs/b3nd-wallet-server/ /app/libs/b3nd-wallet-server/
COPY ./libs/b3nd-apps/ /app/libs/b3nd-apps/
COPY ./libs/b3nd-managed-node/ /app/libs/b3nd-managed-node/

# Copy all workspace apps
COPY ./apps/apps-node/ /app/apps/apps-node/
COPY ./apps/b3nd-cli/ /app/apps/b3nd-cli/
COPY ./apps/b3nd-node/ /app/apps/b3nd-node/
COPY ./apps/sdk-inspector/ /app/apps/sdk-inspector/
COPY ./apps/vault-listener/ /app/apps/vault-listener/
COPY ./apps/wallet-node/ /app/apps/wallet-node/

# Workspace stubs for members excluded by .dockerignore
COPY ./tests/deno.json /app/tests/deno.json
COPY ./.claude-plugin/mcp-server/deno.json /app/.claude-plugin/mcp-server/deno.json

WORKDIR /app/apps/apps-node

# Cache dependencies
RUN deno cache ./src/mod.ts

EXPOSE 8844

CMD ["deno", "run", "-A", "./src/mod.ts"]
