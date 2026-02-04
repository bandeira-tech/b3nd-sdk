FROM denoland/deno:latest

WORKDIR /app

# Copy app-backend sources only; SDK is pulled from JSR during cache
COPY deno.json deno.lock ./
COPY src ./src

RUN deno cache --lock=deno.lock src/mod.ts

EXPOSE 8844

CMD ["run", "--allow-net", "--allow-read", "--allow-env", "src/mod.ts"]
