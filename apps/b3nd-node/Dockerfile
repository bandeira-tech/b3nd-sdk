FROM denoland/deno:2.5.6

WORKDIR /app

# Copy workspace root config
COPY ./deno.json ./deno.lock /app/

# Copy SDK source (needed for workspace imports)
COPY ./src/ /app/src/

# Copy all workspace libs
COPY ./libs/ /app/libs/

# Copy all workspace apps
COPY ./apps/b3nd-node/ /app/apps/b3nd-node/
COPY ./apps/apps-node/ /app/apps/apps-node/
COPY ./apps/b3nd-cli/ /app/apps/b3nd-cli/
COPY ./apps/sdk-inspector/ /app/apps/sdk-inspector/
COPY ./apps/vault-listener/ /app/apps/vault-listener/
COPY ./apps/wallet-node/ /app/apps/wallet-node/

# Workspace stubs for members not shipped with the image
COPY ./tests/deno.json /app/tests/deno.json
COPY ./.claude-plugin/mcp-server/deno.json /app/.claude-plugin/mcp-server/deno.json

WORKDIR /app/apps/b3nd-node

RUN deno cache ./mod.ts

EXPOSE 9942

CMD ["deno", "run", "-A", "./mod.ts"]
