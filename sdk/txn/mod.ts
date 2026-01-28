/**
 * @b3nd/txn - Transaction Layer
 *
 * The transaction layer introduces governance to B3nd. All state changes
 * happen through transactions, which go through validation before propagation.
 *
 * Key concepts:
 * - Transaction: [uri, data] tuple - the universal primitive
 * - TXN Node: Validates and propagates transactions
 * - Data Node: Listens to txn stream, materializes state
 *
 * Usage:
 * ```typescript
 * import { createTransactionNode, createDataNode } from "@b3nd/txn"
 * import { createHttpClient, createMemoryClient } from "@b3nd/clients"
 *
 * // Create a transaction node
 * const txnNode = createTransactionNode({
 *   validate: myValidator,
 *   read: createHttpClient("http://localhost:8842"),
 *   peers: [createWebSocketClient("ws://peer:8843")]
 * })
 *
 * // Submit a transaction
 * const result = await txnNode.submit([
 *   "txn://alice/transfer/42",
 *   { inputs: [...], outputs: [...], sig: "..." }
 * ])
 * ```
 */

// Re-export types
export * from "./types.ts";

import type {
  DataNode,
  DataNodeConfig,
  MaterializeContext,
  ReceiveResult,
  StoreMeta,
  Transaction,
  TransactionFilter,
  TransactionNode,
  TransactionNodeConfig,
  TransactionNodeHealth,
  ValidationContext,
} from "./types.ts";

// =============================================================================
// TRANSACTION NODE IMPLEMENTATION
// =============================================================================

/**
 * Create a transaction node
 *
 * The transaction node validates incoming transactions and propagates
 * valid ones to peers. It does not store transactions itself - that's
 * the job of data nodes (which can be peers).
 *
 * @param config - Node configuration
 * @returns A transaction node instance
 *
 * @example
 * ```typescript
 * import { createTransactionNode } from "@b3nd/txn"
 * import { createHttpClient, createPostgresClient } from "@b3nd/clients"
 *
 * const node = createTransactionNode({
 *   validate: async ([uri, data], ctx) => {
 *     // Validate signature
 *     if (!await verifySignature(data.sig)) {
 *       return { valid: false, error: "invalid_signature" }
 *     }
 *     // Check owner
 *     const owner = uri.match(/accounts\/([^/]+)/)?.[1]
 *     if (owner !== data.origin) {
 *       return { valid: false, error: "not_owner" }
 *     }
 *     return { valid: true }
 *   },
 *   read: createHttpClient("http://localhost:8842"),
 *   peers: [
 *     createPostgresClient({ ... }),  // Local storage
 *     createWebSocketClient("ws://peer:8843")  // Remote peer
 *   ]
 * })
 *
 * // Submit a transaction
 * const result = await node.submit([
 *   "txn://alice/profile/1",
 *   { origin: "alice", sig: "...", data: { name: "Alice" } }
 * ])
 * ```
 */
export function createTransactionNode<D = unknown>(
  config: TransactionNodeConfig<D>,
): TransactionNode<D> {
  const {
    validate,
    read,
    peers = [],
    validationTimeout = 30000,
    propagationTimeout = 5000,
    awaitPropagation = false,
  } = config;

  // Statistics
  const stats = {
    received: 0,
    accepted: 0,
    rejected: 0,
    propagated: 0,
  };

  // Subscribers for the transaction stream
  const subscribers: Set<{
    filter?: TransactionFilter;
    push: (tx: Transaction<D>) => void;
    done: () => void;
  }> = new Set();

  // Create validation context
  const ctx: ValidationContext = {
    read: async <T = unknown>(uri: string) => {
      return read.read<T>(uri);
    },
  };

  /**
   * Propagate a transaction to all peers
   */
  async function propagate(
    tx: Transaction<D>,
  ): Promise<ReceiveResult["propagation"]> {
    if (peers.length === 0) {
      return { total: 0, succeeded: 0, failed: 0 };
    }

    const [uri, data] = tx;
    const results = await Promise.allSettled(
      peers.map(async (peer) => {
        // Use AbortController for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          propagationTimeout,
        );

        try {
          // Write the transaction to the peer
          // The URI is the transaction URI, data is the transaction data
          const result = await peer.write(uri, data);
          clearTimeout(timeoutId);
          if (!result.success) {
            throw new Error(result.error || "write_failed");
          }
          return result;
        } catch (error) {
          clearTimeout(timeoutId);
          throw error;
        }
      }),
    );

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => String(r.reason));

    stats.propagated += succeeded;

    return {
      total: peers.length,
      succeeded,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Notify subscribers of a new transaction
   */
  function notifySubscribers(tx: Transaction<D>): void {
    for (const subscriber of subscribers) {
      // Apply filter if present
      if (subscriber.filter) {
        const [uri] = tx;
        if (subscriber.filter.prefix && !uri.startsWith(subscriber.filter.prefix)) {
          continue;
        }
        if (subscriber.filter.pattern) {
          const regex = new RegExp(
            subscriber.filter.pattern.replace(/\*/g, ".*"),
          );
          if (!regex.test(uri)) {
            continue;
          }
        }
        if (subscriber.filter.filter && !subscriber.filter.filter(tx)) {
          continue;
        }
      }
      subscriber.push(tx);
    }
  }

  /**
   * Match a URI against a filter
   */
  function matchesFilter(
    _uri: string,
    _filter?: TransactionFilter,
  ): boolean {
    // Implementation handled inline in notifySubscribers for performance
    return true;
  }

  // The transaction node implementation
  const node: TransactionNode<D> = {
    async receive(tx: Transaction<D>): Promise<ReceiveResult> {
      const [uri] = tx;
      const ts = Date.now();
      stats.received++;

      // Validate with timeout
      let validationResult;
      try {
        validationResult = await Promise.race([
          validate(tx, ctx),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("validation_timeout")),
              validationTimeout,
            )
          ),
        ]);
      } catch (error) {
        stats.rejected++;
        return {
          accepted: false,
          error: error instanceof Error ? error.message : "validation_error",
          uri,
          ts,
        };
      }

      if (!validationResult.valid) {
        stats.rejected++;
        return {
          accepted: false,
          error: validationResult.error || "validation_failed",
          uri,
          ts,
        };
      }

      stats.accepted++;

      // Notify subscribers
      notifySubscribers(tx);

      // Propagate to peers
      if (awaitPropagation) {
        const propagation = await propagate(tx);
        return {
          accepted: true,
          uri,
          ts,
          propagation,
        };
      } else {
        // Fire and forget propagation
        propagate(tx).catch(() => {
          // Propagation errors are logged but don't affect the result
        });
        return {
          accepted: true,
          uri,
          ts,
        };
      }
    },

    submit(tx: Transaction<D>): Promise<ReceiveResult> {
      return node.receive(tx);
    },

    subscribe(filter?: TransactionFilter): AsyncIterable<Transaction<D>> {
      return {
        [Symbol.asyncIterator](): AsyncIterator<Transaction<D>> {
          const queue: Transaction<D>[] = [];
          let resolveNext: ((value: IteratorResult<Transaction<D>>) => void) | null = null;
          let done = false;

          const subscriber = {
            filter,
            push: (tx: Transaction<D>) => {
              if (done) return;
              if (resolveNext) {
                resolveNext({ value: tx, done: false });
                resolveNext = null;
              } else {
                queue.push(tx);
              }
            },
            done: () => {
              done = true;
              if (resolveNext) {
                resolveNext({ value: undefined as unknown as Transaction<D>, done: true });
                resolveNext = null;
              }
            },
          };

          subscribers.add(subscriber);

          return {
            async next(): Promise<IteratorResult<Transaction<D>>> {
              if (done && queue.length === 0) {
                return { value: undefined as unknown as Transaction<D>, done: true };
              }
              if (queue.length > 0) {
                return { value: queue.shift()!, done: false };
              }
              return new Promise((resolve) => {
                resolveNext = resolve;
              });
            },
            async return(): Promise<IteratorResult<Transaction<D>>> {
              subscribers.delete(subscriber);
              done = true;
              return { value: undefined as unknown as Transaction<D>, done: true };
            },
          };
        },
      };
    },

    async health(): Promise<TransactionNodeHealth> {
      // Check read source health
      let readHealth;
      try {
        const h = await read.health();
        readHealth = { status: h.status, message: h.message };
      } catch (error) {
        readHealth = {
          status: "unhealthy" as const,
          message: error instanceof Error ? error.message : "health_check_failed",
        };
      }

      // Check peer health
      const peerHealth = await Promise.all(
        peers.map(async (peer, index) => {
          try {
            const h = await peer.health();
            return {
              uri: `peer-${index}`,
              status: h.status === "healthy" ? "connected" as const : "error" as const,
              message: h.message,
            };
          } catch (error) {
            return {
              uri: `peer-${index}`,
              status: "disconnected" as const,
              message: error instanceof Error ? error.message : "health_check_failed",
            };
          }
        }),
      );

      // Determine overall status
      const hasUnhealthyRead = readHealth.status === "unhealthy";
      const hasDisconnectedPeers = peerHealth.some((p) => p.status === "disconnected");
      const allPeersDown = peers.length > 0 && peerHealth.every((p) => p.status !== "connected");

      let status: "healthy" | "degraded" | "unhealthy";
      let message: string | undefined;

      if (hasUnhealthyRead) {
        status = "unhealthy";
        message = "Read source unhealthy";
      } else if (allPeersDown) {
        status = "degraded";
        message = "All peers disconnected";
      } else if (hasDisconnectedPeers) {
        status = "degraded";
        message = "Some peers disconnected";
      } else {
        status = "healthy";
      }

      return {
        status,
        message,
        read: readHealth,
        peers: peerHealth,
        stats: { ...stats },
      };
    },

    async cleanup(): Promise<void> {
      // Notify all subscribers they're done
      for (const subscriber of subscribers) {
        subscriber.done();
      }
      subscribers.clear();

      // Cleanup peers
      await Promise.all(peers.map((peer) => peer.cleanup()));

      // Cleanup read source
      await read.cleanup();
    },
  };

  return node;
}

// =============================================================================
// DATA NODE IMPLEMENTATION
// =============================================================================

/**
 * Create a data node that materializes state from a transaction stream
 *
 * Data nodes subscribe to transaction streams (from txn nodes) and
 * decide what to store based on their materialize function.
 *
 * @param config - Data node configuration
 * @returns A data node instance
 *
 * @example
 * ```typescript
 * import { createDataNode } from "@b3nd/txn"
 * import { createPostgresClient } from "@b3nd/clients"
 *
 * const dataNode = createDataNode({
 *   subscribe: "ws://txn-node:8843/subscribe",
 *   storage: createPostgresClient({ ... }),
 *   materialize: async (txn, ctx) => {
 *     const [uri, data] = txn
 *
 *     // Store the transaction itself
 *     await ctx.store(uri, data)
 *
 *     // Store outputs if present
 *     if (data.outputs) {
 *       for (const [outputUri, value] of data.outputs) {
 *         await ctx.store(outputUri, value, {
 *           status: "pending",
 *           source: uri
 *         })
 *       }
 *     }
 *   }
 * })
 *
 * await dataNode.start()
 * ```
 */
export function createDataNode<D = unknown>(
  config: DataNodeConfig<D>,
): DataNode {
  const {
    subscribe: subscribeUrl,
    storage,
    materialize,
    filter,
    reconnect = { enabled: true, maxAttempts: 10, interval: 1000, backoff: "exponential" },
  } = config;

  let ws: WebSocket | null = null;
  let running = false;
  let reconnectAttempts = 0;
  let lastReceived: number | undefined;

  const stats = {
    processed: 0,
    stored: 0,
    errors: 0,
  };

  // Create materialization context
  const ctx: MaterializeContext = {
    async store<T = unknown>(
      uri: string,
      value: T,
      meta?: StoreMeta,
    ): Promise<void> {
      // Store the value with metadata embedded
      const dataToStore = meta
        ? { __value: value, __meta: meta }
        : value;
      const result = await storage.write(uri, dataToStore);
      if (!result.success) {
        stats.errors++;
        throw new Error(result.error || "store_failed");
      }
      stats.stored++;
    },

    async read<T = unknown>(uri: string) {
      return storage.read<T>(uri);
    },

    async update(uri: string, meta: Partial<StoreMeta>): Promise<void> {
      // Read current value, merge metadata, write back
      const current = await storage.read(uri);
      if (!current.success || !current.record) {
        throw new Error("not_found");
      }

      const data = current.record.data as { __value?: unknown; __meta?: StoreMeta } | unknown;
      let newData;

      if (data && typeof data === "object" && "__value" in data) {
        // Has existing metadata structure
        newData = {
          __value: (data as { __value: unknown }).__value,
          __meta: { ...((data as { __meta?: StoreMeta }).__meta || {}), ...meta },
        };
      } else {
        // Wrap existing value with metadata
        newData = {
          __value: data,
          __meta: meta,
        };
      }

      const result = await storage.write(uri, newData);
      if (!result.success) {
        stats.errors++;
        throw new Error(result.error || "update_failed");
      }
    },
  };

  /**
   * Process a received transaction
   */
  async function processTransaction(tx: Transaction<D>): Promise<void> {
    stats.processed++;
    lastReceived = Date.now();

    // Apply filter if present
    if (filter) {
      const [uri] = tx;
      if (filter.prefix && !uri.startsWith(filter.prefix)) return;
      if (filter.pattern) {
        const regex = new RegExp(filter.pattern.replace(/\*/g, ".*"));
        if (!regex.test(uri)) return;
      }
      if (filter.filter && !filter.filter(tx)) return;
    }

    try {
      await materialize(tx, ctx);
    } catch (error) {
      stats.errors++;
      // Log but don't throw - continue processing other txns
      console.error("Materialization error:", error);
    }
  }

  /**
   * Connect to the transaction stream
   */
  function connect(url: string): void {
    if (!running) return;

    ws = new WebSocket(url);

    ws.onopen = () => {
      reconnectAttempts = 0;
    };

    ws.onmessage = async (event) => {
      try {
        const tx = JSON.parse(event.data as string) as Transaction<D>;
        await processTransaction(tx);
      } catch (error) {
        stats.errors++;
        console.error("Message processing error:", error);
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    ws.onclose = () => {
      ws = null;
      if (running && reconnect.enabled) {
        attemptReconnect(url);
      }
    };
  }

  /**
   * Attempt to reconnect with backoff
   */
  function attemptReconnect(url: string): void {
    if (!running) return;
    if (reconnect.maxAttempts && reconnectAttempts >= reconnect.maxAttempts) {
      console.error("Max reconnect attempts reached");
      return;
    }

    reconnectAttempts++;
    const interval = reconnect.interval || 1000;
    const delay = reconnect.backoff === "exponential"
      ? interval * Math.pow(2, reconnectAttempts - 1)
      : interval * reconnectAttempts;

    setTimeout(() => connect(url), delay);
  }

  const dataNode: DataNode = {
    async start(): Promise<void> {
      if (running) return;
      running = true;

      // Handle multiple subscribe URLs
      const urls = Array.isArray(subscribeUrl) ? subscribeUrl : [subscribeUrl];

      // Connect to first URL (could be enhanced to try others on failure)
      connect(urls[0]);
    },

    async stop(): Promise<void> {
      running = false;
      if (ws) {
        ws.close();
        ws = null;
      }
    },

    async health() {
      let storageHealth;
      try {
        const h = await storage.health();
        storageHealth = { status: h.status };
      } catch {
        storageHealth = { status: "unhealthy" as const };
      }

      const connected = ws !== null && ws.readyState === WebSocket.OPEN;

      let status: "healthy" | "degraded" | "unhealthy";
      if (!running) {
        status = "unhealthy";
      } else if (!connected) {
        status = "degraded";
      } else if (storageHealth.status === "unhealthy") {
        status = "degraded";
      } else {
        status = "healthy";
      }

      return {
        status,
        message: !running ? "Not running" : !connected ? "Disconnected from stream" : undefined,
        subscription: {
          connected,
          lastReceived,
        },
        storage: storageHealth,
        stats: { ...stats },
      };
    },

    async cleanup(): Promise<void> {
      await dataNode.stop();
      await storage.cleanup();
    },
  };

  return dataNode;
}

// =============================================================================
// HELPER VALIDATORS
// =============================================================================

/**
 * A validator that accepts all transactions
 * Useful for testing or relay nodes that don't validate content
 */
export const acceptAllValidator: TransactionValidator = async () => ({
  valid: true,
});

/**
 * Create a signature-verifying validator
 *
 * @param verifyFn - Function to verify signatures
 * @param extractSig - Function to extract signature from transaction data
 * @param extractMessage - Function to extract message to verify
 * @returns A validator that checks signatures
 */
export function createSignatureValidator<D>(
  verifyFn: (
    signature: string,
    message: string,
    publicKey: string,
  ) => Promise<boolean>,
  extractSig: (data: D) => { sig: string; publicKey: string },
  extractMessage: (tx: Transaction<D>) => string,
): TransactionValidator<D> {
  return async (tx) => {
    const [, data] = tx;
    try {
      const { sig, publicKey } = extractSig(data);
      const message = extractMessage(tx);
      const valid = await verifyFn(sig, message, publicKey);
      return {
        valid,
        error: valid ? undefined : "invalid_signature",
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : "signature_verification_failed",
      };
    }
  };
}

/**
 * Combine multiple validators - all must pass
 */
export function combineValidators<D>(
  ...validators: TransactionValidator<D>[]
): TransactionValidator<D> {
  return async (tx, ctx) => {
    for (const validator of validators) {
      const result = await validator(tx, ctx);
      if (!result.valid) {
        return result;
      }
    }
    return { valid: true };
  };
}
