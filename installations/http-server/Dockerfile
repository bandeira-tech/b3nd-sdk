FROM denoland/deno:2.5.6

WORKDIR /app

COPY ./deno.json ./deno.lock /app/
COPY ./mod.ts ./pg-executor.ts ./mongo-executor.ts ./example-schema.ts /app/

# Cache dependencies (requires network at build)
RUN deno cache --lock=./deno.lock ./mod.ts

CMD ["deno", "run", "-A", "./mod.ts"]
