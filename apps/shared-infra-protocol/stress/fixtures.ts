/**
 * Shared test fixtures: a MessageDataClient-backed rig with the shared-infra
 * schema loaded, plus a helper that builds the same rig with a second
 * "replica" client so we can stress the multi-backend broadcast path.
 */

import { connection, Rig } from "../../../libs/b3nd-rig/mod.ts";
import {
  firstMatchSequence,
  parallelBroadcast,
} from "../../../libs/b3nd-combinators/mod.ts";
import { MemoryStore } from "../../../libs/b3nd-client-memory/store.ts";
import { MessageDataClient } from "../../../libs/b3nd-core/message-data-client.ts";
import type { NodeProtocolInterface } from "../../../libs/b3nd-core/types.ts";
import { createSharedInfraSchema } from "../schema/mod.ts";
import { AppClient } from "../../shared-infra-protocol/sdk/mod.ts";

export interface Fixture {
  /** The rig as a NodeProtocolInterface — pass to AppClient as `client`. */
  client: NodeProtocolInterface;
  /** Individual backends (for asserting replication). */
  backends: MessageDataClient[];
  /** The underlying rig, for observing events. */
  rig: Rig;
}

export function buildRig(options: {
  backends?: number;
  requireAppRegistration?: boolean;
  operatorPubkeys?: string[];
  maxPayloadBytes?: number;
} = {}): Fixture {
  const backendCount = options.backends ?? 1;
  const backends = Array.from(
    { length: backendCount },
    () => new MessageDataClient(new MemoryStore()),
  );

  const merged: NodeProtocolInterface = backendCount === 1 ? backends[0] : ({
    receive: (msg: Parameters<typeof backends[0]["receive"]>[0]) =>
      parallelBroadcast(backends).receive(msg),
    read: <T = unknown>(uris: string | string[]) =>
      firstMatchSequence(backends).read<T>(uris),
    status: () => backends[0].status(),
  } as unknown as NodeProtocolInterface);

  const rig = new Rig({
    connections: [connection(merged, { receive: ["*"], read: ["*"] })],
    schema: createSharedInfraSchema({
      requireAppRegistration: options.requireAppRegistration ?? true,
      operatorPubkeys: options.operatorPubkeys,
      maxPayloadBytes: options.maxPayloadBytes,
    }),
  });

  return { client: rig, backends, rig };
}

export function appClient(fixture: Fixture, appId: string): AppClient {
  return new AppClient({ appId, client: fixture.client });
}
