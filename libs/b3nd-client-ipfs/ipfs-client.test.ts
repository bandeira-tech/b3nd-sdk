/**
 * IpfsClient Tests
 *
 * Tests the IPFS client implementation using the shared test suite.
 * Uses an in-memory executor that simulates IPFS add/cat/pin operations.
 */

/// <reference lib="deno.ns" />

import { IpfsClient, type IpfsExecutor } from "./mod.ts";
import { runSharedSuite } from "../b3nd-testing/shared-suite.ts";
import { runNodeSuite } from "../b3nd-testing/node-suite.ts";
import type { PersistenceRecord, Schema } from "../b3nd-core/types.ts";

/**
 * In-memory IpfsExecutor that simulates IPFS behavior.
 * Uses a simple content-addressed store: CID = "Qm" + hash of content.
 */
class MemoryIpfsExecutor implements IpfsExecutor {
  private readonly store = new Map<string, string>();
  private readonly pins = new Set<string>();
  private cidCounter = 0;

  async add(content: string): Promise<string> {
    // Generate a deterministic-ish CID from content + counter
    const cid = `QmTest${this.cidCounter++}_${content.length}`;
    this.store.set(cid, content);
    return cid;
  }

  async cat(cid: string): Promise<string> {
    const content = this.store.get(cid);
    if (content === undefined) {
      throw new Error(`CID not found: ${cid}`);
    }
    return content;
  }

  async pin(cid: string): Promise<void> {
    this.pins.add(cid);
  }

  async unpin(cid: string): Promise<void> {
    this.pins.delete(cid);
  }

  async listPins(): Promise<string[]> {
    return [...this.pins];
  }

  async isOnline(): Promise<boolean> {
    return true;
  }

  async cleanup(): Promise<void> {
    this.store.clear();
    this.pins.clear();
  }
}

function createSchema(
  validator?: (value: unknown) => Promise<{ valid: boolean; error?: string }>,
): Schema {
  const defaultValidator = async (
    { value, read }: { value: unknown; read: unknown },
  ) => {
    if (validator) {
      return validator(value);
    }
    const _ = read as <T = unknown>(
      uri: string,
    ) => Promise<{ success: boolean; record?: PersistenceRecord<T> }>;
    return { valid: true };
  };

  return {
    "store://users": defaultValidator,
    "store://files": defaultValidator,
    "store://pagination": defaultValidator,
  };
}

function createClient(schema: Schema): IpfsClient {
  const executor = new MemoryIpfsExecutor();
  return new IpfsClient(
    {
      apiUrl: "http://localhost:5001",
      schema,
    },
    executor,
  );
}

runSharedSuite("IpfsClient", {
  happy: () => createClient(createSchema()),

  validationError: () =>
    createClient(
      createSchema(async (value) => {
        const data = value as { name?: string };
        if (!data.name) {
          return { valid: false, error: "Name is required" };
        }
        return { valid: true };
      }),
    ),
});

runNodeSuite("IpfsClient", {
  happy: () => createClient(createSchema()),

  validationError: () =>
    createClient(
      createSchema(async (value) => {
        const data = value as { name?: string };
        if (!data.name) {
          return { valid: false, error: "Name is required" };
        }
        return { valid: true };
      }),
    ),
});
