import type { DeleteResult, ListOptions, ListResult, NodeProtocolReadInterface, NodeProtocolWriteInterface, ReadResult, WriteResult } from "../../src/types.ts";

export function parallelBroadcast(clients: (NodeProtocolWriteInterface & NodeProtocolReadInterface)[]): NodeProtocolWriteInterface & NodeProtocolReadInterface {
  if (!clients || clients.length === 0) throw new Error("clients array is required and cannot be empty");

  return {
    async write<T>(uri: string, value: T): Promise<WriteResult<T>> {
      const results = await Promise.allSettled(clients.map(c => c.write(uri, value)));
      const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
      if (rejected) return { success: false, error: rejected.reason instanceof Error ? rejected.reason.message : String(rejected.reason) };
      const failures = results.filter((r: any) => r.status === 'fulfilled' && r.value?.success === false) as PromiseFulfilledResult<WriteResult<T>>[];
      if (failures.length) return { success: false, error: failures[0].value.error || 'Broadcast write failed' };
      const first = results.find((r: any) => r.status === 'fulfilled' && r.value?.success) as PromiseFulfilledResult<WriteResult<T>> | undefined;
      return first?.value ?? { success: true, record: { ts: Date.now(), data: value } };
    },

    async read<T>(uri: string): Promise<ReadResult<T>> {
      // Read from the first client only; composition for reads is handled by firstMatchSequence in the sketch
      return clients[0].read(uri);
    },

    async list(uri: string, options?: ListOptions): Promise<ListResult> {
      return clients[0].list(uri, options);
    },

    async delete(uri: string): Promise<DeleteResult> {
      const results = await Promise.allSettled(clients.map(c => c.delete(uri)));
      const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
      if (rejected) return { success: false, error: rejected.reason instanceof Error ? rejected.reason.message : String(rejected.reason) };
      const failures = results.filter((r: any) => r.status === 'fulfilled' && r.value?.success === false) as PromiseFulfilledResult<DeleteResult>[];
      if (failures.length) return { success: false, error: failures[0].value.error || 'Broadcast delete failed' };
      return { success: true };
    },

    async health() { return clients[0].health(); },
    async getSchema() { return clients[0].getSchema(); },
    async cleanup() { await Promise.all(clients.map(c => c.cleanup())); },
  };
}
