/**
 * @b3nd/txn Types
 * Transaction layer types for the B3nd protocol
 *
 * The transaction layer introduces governance: all state changes happen through
 * transactions, which go through validation. The data layer remains for reads,
 * but writes now flow through the txn layer.
 *
 * Two node types:
 * - TXN NODE: Receives txns, validates, propagates to peers
 * - DATA NODE: Listens to txn stream, stores what it chooses, serves reads
 */

import type {
  NodeProtocolReadInterface,
  NodeProtocolWriteInterface,
  ReadResult,
} from "../src/types.ts";

// =============================================================================
// THE PRIMITIVE
// =============================================================================

/**
 * A transaction is a tuple: [uri, data]
 *
 * The URI is the transaction's identity. The data is the transaction's content.
 * Both are protocol-defined, but the structure is uniform.
 *
 * Examples:
 * ```typescript
 * // A user transaction
 * ["txn://alice/transfer/42", { inputs: [...], outputs: [...], sig: "..." }]
 *
 * // A block transaction
 * ["txn://firecat/block/1000", { prev: "txn://firecat/block/999", txns: [...] }]
 *
 * // A simple key-value
 * ["user:alice", { name: "Alice" }]
 * ```
 */
export type Transaction<D = unknown> = [uri: string, data: D];

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Result of validating a transaction
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  /** Optional additional context about the validation */
  details?: Record<string, unknown>;
}

/**
 * Context passed to transaction validators
 * Provides read access to state for validation decisions
 */
export interface ValidationContext {
  /**
   * Read a URI's current value
   * This is the state the validator uses to make decisions
   */
  read: <T = unknown>(uri: string) => Promise<ReadResult<T>>;
}

/**
 * A transaction validator function
 *
 * Validators are read-only - they cannot write. Everything needed for
 * validation must exist in the transaction or be readable from current state.
 *
 * The validator receives:
 * - tx: The transaction to validate
 * - ctx: Context with read access to current state
 *
 * Example validators:
 * ```typescript
 * // Accept all (simple key-value)
 * const acceptAll: TransactionValidator = async () => ({ valid: true })
 *
 * // Signature verification
 * const signed: TransactionValidator = async ([uri, data]) => {
 *   const valid = await verifySignature(data.sig, data.message)
 *   return { valid, error: valid ? undefined : "invalid_signature" }
 * }
 *
 * // Owner-only writes
 * const ownerOnly: TransactionValidator = async ([uri, data], ctx) => {
 *   const owner = uri.match(/accounts\/([^/]+)/)?.[1]
 *   if (owner !== data.origin) return { valid: false, error: "not_owner" }
 *   return { valid: true }
 * }
 * ```
 */
export type TransactionValidator<D = unknown> = (
  tx: Transaction<D>,
  ctx: ValidationContext,
) => Promise<ValidationResult>;

// =============================================================================
// TRANSACTION NODE
// =============================================================================

/**
 * Result of receiving/submitting a transaction
 */
export interface ReceiveResult {
  /** Whether the transaction was accepted (passed validation) */
  accepted: boolean;
  /** Error message if not accepted */
  error?: string;
  /** The transaction URI */
  uri: string;
  /** Timestamp when received */
  ts: number;
  /** Peer propagation results (if any) */
  propagation?: {
    total: number;
    succeeded: number;
    failed: number;
    errors?: string[];
  };
}

/**
 * Configuration for creating a transaction node
 *
 * Example:
 * ```typescript
 * const node = createTransactionNode({
 *   validate: myValidator,
 *   read: createHttpClient("http://localhost:8842"),
 *   peers: [
 *     createWebSocketClient("ws://peer-a:8843"),
 *     createPostgresClient("postgres://..."),
 *   ]
 * })
 * ```
 */
export interface TransactionNodeConfig<D = unknown> {
  /**
   * The validator function for this node
   * Must return { valid: true } for transactions to be accepted and propagated
   */
  validate: TransactionValidator<D>;

  /**
   * How to read state for validation
   * This is used by the validator to check current state
   *
   * Can be:
   * - A single client (HttpClient, MemoryClient, etc.)
   * - A composite using firstMatchSequence for fallback chains
   * - Any NodeProtocolReadInterface
   */
  read: NodeProtocolReadInterface;

  /**
   * Peers to propagate valid transactions to
   *
   * Can include:
   * - Remote txn nodes (WebSocketClient to "ws://txn-node:8843")
   * - Local storage (PostgresClient, MemoryClient)
   * - Any NodeProtocolWriteInterface
   *
   * When a txn node propagates to a postgres peer, that postgres
   * becomes a data node storing txns. The same client abstraction
   * works for both reading and peering.
   */
  peers?: NodeProtocolWriteInterface[];

  /**
   * Optional: maximum time (ms) to wait for validation
   * Default: 30000
   */
  validationTimeout?: number;

  /**
   * Optional: maximum time (ms) to wait for peer propagation
   * Default: 5000
   */
  propagationTimeout?: number;

  /**
   * Optional: whether to wait for peer propagation before returning
   * If false, propagation happens async and receive() returns immediately
   * Default: false
   */
  awaitPropagation?: boolean;
}

/**
 * A transaction node
 *
 * The node has two concerns:
 * 1. Validate transactions using the provided validator and read source
 * 2. Propagate valid transactions to peers
 *
 * There is no "write" method on the txn node - it only receives.
 * The write happens when propagating to peers (which may be storage backends).
 */
export interface TransactionNode<D = unknown> {
  /**
   * Receive a transaction for validation and propagation
   *
   * Flow:
   * 1. Validate via validate(txn, { read })
   * 2. If valid, propagate to peers
   * 3. Return result with acceptance status
   */
  receive(tx: Transaction<D>): Promise<ReceiveResult>;

  /**
   * Alias for receive() - submit a transaction
   */
  submit(tx: Transaction<D>): Promise<ReceiveResult>;

  /**
   * Subscribe to the transaction stream
   * Returns an async iterable of valid transactions
   */
  subscribe(filter?: TransactionFilter): AsyncIterable<Transaction<D>>;

  /**
   * Health check for the transaction node
   */
  health(): Promise<TransactionNodeHealth>;

  /**
   * Cleanup resources
   */
  cleanup(): Promise<void>;
}

/**
 * Filter for subscribing to transactions
 */
export interface TransactionFilter {
  /** Filter by URI prefix */
  prefix?: string;
  /** Filter by URI pattern (glob) */
  pattern?: string;
  /** Custom filter function */
  filter?: (tx: Transaction) => boolean;
}

/**
 * Health status for a transaction node
 */
export interface TransactionNodeHealth {
  status: "healthy" | "degraded" | "unhealthy";
  message?: string;
  /** Read source health */
  read?: {
    status: "healthy" | "degraded" | "unhealthy";
    message?: string;
  };
  /** Peer connection status */
  peers?: Array<{
    uri: string;
    status: "connected" | "disconnected" | "error";
    message?: string;
  }>;
  /** Statistics */
  stats?: {
    received: number;
    accepted: number;
    rejected: number;
    propagated: number;
  };
}

// =============================================================================
// DATA NODE (Materialization)
// =============================================================================

/**
 * Metadata stored with materialized data
 */
export interface StoreMeta {
  /** Status of this data (protocol-defined, e.g., "pending", "confirmed") */
  status?: string;
  /** URI of the transaction that created this data */
  source?: string;
  /** URI of the block/txn that confirmed this data */
  confirmedBy?: string;
  /** Additional protocol-specific metadata */
  [key: string]: unknown;
}

/**
 * Context for materialization functions
 */
export interface MaterializeContext {
  /**
   * Store a value at a URI
   * @param uri - The URI to store at
   * @param value - The value to store
   * @param meta - Optional metadata (status, source, etc.)
   */
  store: <T = unknown>(
    uri: string,
    value: T,
    meta?: StoreMeta,
  ) => Promise<void>;

  /**
   * Read a value from storage
   */
  read: <T = unknown>(uri: string) => Promise<ReadResult<T>>;

  /**
   * Update metadata for an existing record
   */
  update: (uri: string, meta: Partial<StoreMeta>) => Promise<void>;
}

/**
 * Materialization function for data nodes
 *
 * Called for each transaction received from the stream.
 * Decides what to store and how.
 *
 * Example:
 * ```typescript
 * const materialize = async (txn, ctx) => {
 *   const [uri, data] = txn
 *
 *   // Store the txn itself
 *   await ctx.store(uri, data)
 *
 *   // If it has outputs, store them
 *   if (data.outputs) {
 *     for (const [outputUri, value] of data.outputs) {
 *       await ctx.store(outputUri, value, { status: "pending", source: uri })
 *     }
 *   }
 * }
 * ```
 */
export type MaterializeFn<D = unknown> = (
  txn: Transaction<D>,
  ctx: MaterializeContext,
) => Promise<void>;

/**
 * Configuration for creating a data node
 *
 * Data nodes listen to a transaction stream and materialize state.
 */
export interface DataNodeConfig<D = unknown> {
  /**
   * Where to get transactions from
   * Can be a WebSocket URL or array of URLs for redundancy
   */
  subscribe: string | string[];

  /**
   * Storage backend for persisting materialized data
   */
  storage: NodeProtocolWriteInterface & NodeProtocolReadInterface;

  /**
   * Materialization function
   * Receives each transaction and decides what to store
   */
  materialize: MaterializeFn<D>;

  /**
   * Optional: filter which transactions to process
   */
  filter?: TransactionFilter;

  /**
   * Optional: reconnection config for subscription
   */
  reconnect?: {
    enabled: boolean;
    maxAttempts?: number;
    interval?: number;
    backoff?: "linear" | "exponential";
  };
}

/**
 * A data node that materializes state from a transaction stream
 */
export interface DataNode {
  /**
   * Start listening to the transaction stream
   */
  start(): Promise<void>;

  /**
   * Stop listening
   */
  stop(): Promise<void>;

  /**
   * Health check
   */
  health(): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    message?: string;
    subscription?: {
      connected: boolean;
      lastReceived?: number;
    };
    storage?: {
      status: "healthy" | "degraded" | "unhealthy";
    };
    stats?: {
      processed: number;
      stored: number;
      errors: number;
    };
  }>;

  /**
   * Cleanup resources
   */
  cleanup(): Promise<void>;
}

// =============================================================================
// HTTP SERVER TYPES
// =============================================================================

/**
 * Configuration for the transaction HTTP server
 */
export interface TransactionServerConfig<D = unknown> {
  /**
   * The transaction node to use
   */
  node: TransactionNode<D>;

  /**
   * Port to listen on
   * Default: 8843
   */
  port?: number;

  /**
   * CORS configuration
   */
  cors?: {
    origin?: string | string[];
    methods?: string[];
    headers?: string[];
  };
}
