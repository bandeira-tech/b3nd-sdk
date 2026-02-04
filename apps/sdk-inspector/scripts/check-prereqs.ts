#!/usr/bin/env -S deno run -A
/**
 * Check prerequisites for running the dashboard
 *
 * This script verifies that a container runtime (podman or docker) is available
 * and running. Individual tests handle their own container setup - this just
 * ensures the runtime is ready.
 */

async function checkContainerRuntime(): Promise<{ runtime: string; ok: boolean }> {
  // Try podman first
  for (const runtime of ["podman", "docker"]) {
    try {
      const cmd = new Deno.Command(runtime, {
        args: ["info"],
        stdout: "null",
        stderr: "null",
      });
      const result = await cmd.output();
      if (result.code === 0) {
        return { runtime, ok: true };
      }
    } catch {
      // Runtime not found or not working
    }
  }
  return { runtime: "none", ok: false };
}

async function main() {
  console.log("Checking prerequisites...\n");

  const { runtime, ok } = await checkContainerRuntime();

  if (!ok) {
    console.error("❌ No container runtime available (podman or docker)");
    console.error("\nDatabase tests (postgres, mongo) require a container runtime.");
    console.error("Please install and start podman or docker.\n");
    console.error("For podman on macOS:");
    console.error("  brew install podman");
    console.error("  podman machine init");
    console.error("  podman machine start\n");
    Deno.exit(1);
  }

  console.log(`✓ Container runtime: ${runtime}`);
  console.log("\n✓ All prerequisites met. Starting dashboard server...\n");
}

main();
