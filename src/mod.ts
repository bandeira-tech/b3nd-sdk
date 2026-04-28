/**
 * @module
 * Universal B3nd persistence SDK for all platforms.
 *
 * Re-exports everything from core (framework foundation) and
 * canon (protocol-building toolkit). For selective imports, use
 * the subpath exports: `./core`, `./canon`, `./msg`, `./hash`,
 * `./auth`, `./encrypt`, `./wallet`, `./network`, `./listener`.
 *
 * @example Basic usage
 * ```typescript
 * import { MemoryStore, DataStoreClient } from "@bandeira-tech/b3nd-sdk";
 *
 * const client = new DataStoreClient(new MemoryStore());
 *
 * // Write
 * await client.receive([["mutable://users/alice", { name: "Alice", age: 30 }]]);
 *
 * // Read data
 * const results = await client.read("mutable://users/alice");
 * console.log(results[0]?.record?.data); // { name: "Alice", age: 30 }
 * ```
 *
 * @example Authenticated send
 * ```typescript
 * import { Identity, Rig, connection, message } from "@bandeira-tech/b3nd-sdk";
 *
 * const id = await Identity.fromSeed("my-secret");
 * const rig = new Rig({
 *   connections: [connection(client, { receive: ["*"], read: ["*"] })],
 * });
 *
 * const outputs = [["mutable://app/key", { hello: "world" }]];
 * const auth = [await id.sign({ inputs: [], outputs })];
 * const envelope = await message({ auth, inputs: [], outputs });
 * await rig.send([envelope, ...outputs]);
 * ```
 */

export * from "@bandeira-tech/b3nd-core";
export * from "@bandeira-tech/b3nd-canon";
