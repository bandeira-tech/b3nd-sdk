/**
 * Local runner for managed node networks.
 *
 * Spawns `deno run` child processes for each node in a manifest.
 * Lighter weight than Docker Compose for rapid development iteration.
 * Expects databases to already be running locally.
 */

import type { NetworkManifest, NetworkNodeEntry } from "./types.ts";

export interface LocalRunnerOptions {
  /** Path to the managed node entry point */
  entryPoint: string;
  /** Operator's public key hex */
  operatorPubKeyHex: string;
  /** Config server URL (must already be running) */
  configServerUrl: string;
  /** Map of nodeId -> private key PEM */
  nodeKeys: Record<string, string>;
  /** Additional Deno flags */
  denoFlags?: string[];
}

export interface RunningNode {
  nodeId: string;
  name: string;
  process: Deno.ChildProcess;
  port: number;
}

export interface LocalNetwork {
  nodes: RunningNode[];
  stop(): Promise<void>;
}

/**
 * Start a local network by spawning Deno processes for each node.
 */
export async function startLocalNetwork(
  manifest: NetworkManifest,
  options: LocalRunnerOptions,
): Promise<LocalNetwork> {
  const running: RunningNode[] = [];

  for (const node of manifest.nodes) {
    const privateKeyPem = options.nodeKeys[node.nodeId];
    if (!privateKeyPem) {
      console.error(`[local-runner] No private key for node ${node.nodeId} (${node.name}), skipping`);
      continue;
    }

    const env: Record<string, string> = {
      // Phase 1: bootstrap
      PORT: String(node.config.server.port),
      CORS_ORIGIN: node.config.server.corsOrigin,
      BACKEND_URL: "memory://",
      // Phase 2: managed mode
      NODE_ID: node.nodeId,
      NODE_PRIVATE_KEY_PEM: privateKeyPem,
      OPERATOR_KEY: options.operatorPubKeyHex,
      CONFIG_URL: options.configServerUrl,
    };

    const flags = options.denoFlags ?? ["-A"];
    const command = new Deno.Command("deno", {
      args: ["run", ...flags, options.entryPoint],
      env,
      stdout: "piped",
      stderr: "piped",
    });

    const process = command.spawn();

    // Stream output with node name prefix
    streamOutput(process, node.name);

    running.push({
      nodeId: node.nodeId,
      name: node.name,
      process,
      port: node.config.server.port,
    });

    console.log(`[local-runner] Started ${node.name} (port ${node.config.server.port})`);
  }

  return {
    nodes: running,
    async stop() {
      for (const node of running) {
        try {
          node.process.kill("SIGTERM");
          await node.process.status;
        } catch {
          // Process may have already exited
        }
      }
      console.log(`[local-runner] Stopped ${running.length} nodes`);
    },
  };
}

function streamOutput(process: Deno.ChildProcess, prefix: string) {
  const decoder = new TextDecoder();

  const readStream = async (stream: ReadableStream<Uint8Array>, log: (...args: string[]) => void) => {
    const reader = stream.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        for (const line of text.split("\n").filter(Boolean)) {
          log(`[${prefix}] ${line}`);
        }
      }
    } finally {
      reader.releaseLock();
    }
  };

  readStream(process.stdout, console.log);
  readStream(process.stderr, console.error);
}
