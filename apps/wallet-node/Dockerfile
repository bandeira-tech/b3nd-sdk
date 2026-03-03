FROM denoland/deno:2.5.6

WORKDIR /app

# Copy workspace-level files needed for resolution
COPY ./deno.json ./deno.lock /app/

# Copy SDK source (needed for imports)
COPY ./src/ /app/src/
COPY ./libs/b3nd-core/ /app/libs/b3nd-core/
COPY ./libs/b3nd-encrypt/ /app/libs/b3nd-encrypt/
COPY ./libs/b3nd-wallet-server/ /app/libs/b3nd-wallet-server/

# Copy the app
COPY ./apps/wallet-node/ /app/apps/wallet-node/

WORKDIR /app/apps/wallet-node

# Cache dependencies
RUN deno cache ./src/mod.ts

EXPOSE 8843

CMD ["deno", "run", "-A", "./src/mod.ts"]
