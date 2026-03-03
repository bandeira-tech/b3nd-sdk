FROM denoland/deno:2.5.6

WORKDIR /app

COPY ./apps/b3nd-node/ /app/

RUN cp deno.docker.json deno.json

RUN deno cache ./mod.ts

EXPOSE 9942

CMD ["deno", "run", "-A", "./mod.ts"]
