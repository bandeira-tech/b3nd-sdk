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
 * import {
 *   Identity, Rig, connection, message,
 *   messageDataHandler, messageDataProgram,
 * } from "@bandeira-tech/b3nd-sdk";
 *
 * const id = await Identity.fromSeed("my-secret");
 * const node = connection(client, ["*"]);
 * const rig = new Rig({
 *   routes: { receive: [node], read: [node], observe: [node] },
 *   programs: { "hash://sha256": messageDataProgram },
 *   handlers: { "msgdata:valid": messageDataHandler },
 * });
 *
 * const outputs = [["mutable://app/key", { hello: "world" }]];
 * const auth = [await id.sign({ inputs: [], outputs })];
 * const envelope = await message({ auth, inputs: [], outputs });
 * await rig.send([envelope]); // canon decomposes; inner outputs land
 * ```
 */

export * from "./core.ts";
export * from "./canon.ts";
