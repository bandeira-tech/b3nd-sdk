/// <reference lib="deno.ns" />

/**
 * Dev helper:
 * - Starts a local Postgres in Docker
 * - Waits for readiness
 * - Runs `deno run --watch -A mod.ts` with DATABASE_URL set
 * - Cleans up the container on exit
 */

const containerName =
  Deno.env.get("POSTGRES_TEST_CONTAINER") ?? "b3nd-http-postgres-dev";
const image = Deno.env.get("POSTGRES_TEST_IMAGE") ?? "postgres:17-alpine";
const db = Deno.env.get("POSTGRES_DB") ?? "b3nd_dev";
const user = Deno.env.get("POSTGRES_USER") ?? "postgres";
const password = Deno.env.get("POSTGRES_PASSWORD") ?? "postgres";
const port = Number(Deno.env.get("POSTGRES_PORT") ?? "55433");

async function startPostgres(): Promise<string> {
  const run = new Deno.Command("docker", {
    args: [
      "run",
      "--rm",
      "-d",
      "--name",
      containerName,
      "-e",
      `POSTGRES_DB=${db}`,
      "-e",
      `POSTGRES_USER=${user}`,
      "-e",
      `POSTGRES_PASSWORD=${password}`,
      "-p",
      `${port}:5432`,
      image,
    ],
    stdout: "piped",
    stderr: "inherit",
  });

  const runResult = await run.output();
  if (runResult.code !== 0) {
    throw new Error("Failed to start PostgreSQL Docker container for dev");
  }

  const isReady = async (): Promise<boolean> => {
    const cmd = new Deno.Command("docker", {
      args: ["exec", containerName, "pg_isready", "-U", user],
      stdout: "null",
      stderr: "null",
    });
    const result = await cmd.output();
    return result.code === 0;
  };

  for (let i = 0; i < 30; i++) {
    if (await isReady()) {
      return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@localhost:${port}/${db}`;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error("PostgreSQL Docker container did not become ready in time");
}

async function stopPostgres() {
  const cmd = new Deno.Command("docker", {
    args: ["rm", "-f", containerName],
    stdout: "null",
    stderr: "null",
  });
  await cmd.output();
}

if (import.meta.main) {
  const envSnapshot = Deno.env.toObject();
  let child: Deno.ChildProcess | undefined;

  const shutdown = async () => {
    try {
      if (child) {
        try {
          child.kill("SIGINT");
        } catch {
          // ignore
        }
        await child.status;
      }
    } finally {
      await stopPostgres();
    }
  };

  Deno.addSignalListener("SIGINT", () => {
    shutdown().finally(() => Deno.exit(130));
  });

  try {
    console.log("Starting dev Postgres in Docker...");
    const dbUrl = await startPostgres();
    console.log(`Postgres ready at ${dbUrl}`);

    const env = {
      ...envSnapshot,
      DATABASE_URL: dbUrl,
    };

    const cmd = new Deno.Command("deno", {
      args: ["run", "--watch", "-A", "mod.ts"],
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      env,
    });

    child = cmd.spawn();
    const status = await child.status;
    await stopPostgres();
    Deno.exit(status.code);
  } catch (error) {
    console.error("dev-postgres failed:", error);
    await stopPostgres();
    Deno.exit(1);
  }
}

