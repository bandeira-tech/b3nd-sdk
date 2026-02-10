FROM denoland/deno:2.5.6

WORKDIR /app

# Copy workspace-level files needed for resolution
COPY ./deno.json ./deno.lock /app/

# Copy SDK source (needed for imports)
COPY ./src/ /app/src/
COPY ./libs/b3nd-core/ /app/libs/b3nd-core/
COPY ./libs/b3nd-encrypt/ /app/libs/b3nd-encrypt/
COPY ./libs/b3nd-client-http/ /app/libs/b3nd-client-http/
COPY ./libs/b3nd-apps/ /app/libs/b3nd-apps/

# Copy the app
COPY ./apps/apps-node/ /app/apps/apps-node/

WORKDIR /app/apps/apps-node

# Cache dependencies
RUN deno cache ./src/mod.ts

EXPOSE 8844

CMD ["deno", "run", "-A", "./src/mod.ts"]
