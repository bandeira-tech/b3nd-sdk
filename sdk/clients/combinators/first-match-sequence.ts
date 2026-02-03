import type { DeleteResult, ListOptions, ListResult, NodeProtocolReadInterface, NodeProtocolWriteInterface, ReadMultiResult, ReadResult, ReceiveResult, Transaction } from "../../src/types.ts";

export function firstMatchSequence(clients: (NodeProtocolWriteInterface & NodeProtocolReadInterface)[]): NodeProtocolWriteInterface & NodeProtocolReadInterface {
  if (!clients || clients.length === 0) throw new Error("clients array is required and cannot be empty");

  return {
    async receive<D>(tx: Transaction<D>): Promise<ReceiveResult> {
      // Try each client until one accepts the transaction
      let lastError: string | undefined;
      for (const c of clients) {
        const res = await c.receive<D>(tx);
        if (res.accepted) return res;
        lastError = res.error;
      }
      return { accepted: false, error: lastError || 'No client accepted transaction' };
    },

    async read<T>(uri: string): Promise<ReadResult<T>> {
      for (const c of clients) {
        const res = await c.read<T>(uri);
        if (res.success) return res;
      }
      return { success: false, error: `Not found: ${uri}` };
    },

    async readMulti<T>(uris: string[]): Promise<ReadMultiResult<T>> {
      // Try first client that returns any results
      for (const c of clients) {
        const res = await c.readMulti<T>(uris);
        if (res.success) return res;
      }
      return {
        success: false,
        results: uris.map(uri => ({ uri, success: false as const, error: 'No client returned results' })),
        summary: { total: uris.length, succeeded: 0, failed: uris.length }
      };
    },

    async list(uri: string, options?: ListOptions): Promise<ListResult> {
      for (const c of clients) {
        const res = await c.list(uri, options);
        if (res.success && res.data.length > 0) return res;
      }
      return { success: true, data: [], pagination: { page: options?.page ?? 1, limit: options?.limit ?? 50, total: 0 } };
    },

    async delete(uri: string): Promise<DeleteResult> {
      for (const c of clients) {
        const res = await c.delete(uri);
        if (res.success) return res;
      }
      return { success: false, error: 'Not found' };
    },

    async health() { return clients[0].health(); },
    async getSchema() { return clients[0].getSchema(); },
    async cleanup() { await Promise.all(clients.map(c => c.cleanup())); },
  };
}
