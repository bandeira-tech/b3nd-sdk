FROM denoland/deno:latest

RUN apt-get update && apt-get install -y curl

WORKDIR /app

# Copy only wallet-server sources; SDK is pulled from JSR during cache
COPY deno.json deno.lock ./
COPY src ./src

RUN deno cache --lock=deno.lock src/mod.ts

EXPOSE 8843

CMD ["run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "src/mod.ts"]
