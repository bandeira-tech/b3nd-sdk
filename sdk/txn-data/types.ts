/**
 * @b3nd/txn-data Types
 * Level 2: The inputs/outputs convention for state transitions
 *
 * This module provides a standard way to structure transaction data
 * for explicit state transitions. Protocols that want explicit input/output
 * semantics use this convention.
 *
 * The key insight: inputs and outputs make state changes explicit.
 * - Inputs: URIs consumed or referenced
 * - Outputs: URIs produced with new values
 *
 * This enables:
 * - UTXO models (inputs consumed, outputs created)
 * - Account models (inputs referenced, outputs update)
 * - Atomic swaps (multi-party inputs/outputs)
 * - Fee calculations (size-based from outputs)
 */

import type { Transaction, TransactionValidator, ValidationResult } from "../txn/types.ts";
import type { ReadResult, Schema, ValidationFn } from "../src/types.ts";

// =============================================================================
// TRANSACTION DATA STRUCTURE
// =============================================================================

/**
 * Standard transaction data with explicit inputs and outputs
 *
 * This is a CONVENTION, not a requirement. Protocols that want
 * explicit state transitions use it. Others can use raw Transaction.
 */
export interface TransactionData<V = unknown> {
  /**
   * URIs consumed or referenced by this transaction
   *
   * Semantics are protocol-defined:
   * - UTXO: inputs are consumed (spent)
   * - Account: inputs are referenced (read)
   * - Append-only: inputs are empty
   */
  inputs: string[];

  /**
   * URIs produced with new values
   *
   * Each output is a [uri, value] tuple.
   * The URI is where the value will be stored.
   * The value is what will be stored there.
   */
  outputs: Array<[uri: string, value: V]>;
}

/**
 * A state transaction with explicit inputs/outputs
 *
 * The metadata (M) typically includes:
 * - origin: who submitted the transaction
 * - sig: signature
 * - ts: timestamp
 * - nonce: for replay protection
 *
 * Example:
 * ```typescript
 * const txn: StateTransaction<MyMeta, number> = [
 *   "txn://alice/transfer/42",
 *   {
 *     inputs: ["utxo://alice/1"],
 *     outputs: [
 *       ["utxo://bob/99", 50],
 *       ["utxo://alice/2", 30]
 *     ]
 *   }
 * ]
 * ```
 */
export type StateTransaction<V = unknown> = Transaction<TransactionData<V>>;

// =============================================================================
// SIGNED TRANSACTION TYPES
// =============================================================================

/**
 * Standard metadata for signed transactions
 */
export interface SignedTransactionMeta {
  /** Public key or identifier of the signer */
  origin: string;
  /** Cryptographic signature */
  sig: string;
  /** Timestamp */
  ts?: number;
  /** Nonce for replay protection */
  nonce?: number | string;
}

/**
 * Transaction data that includes signer metadata
 */
export interface SignedTransactionData<V = unknown>
  extends TransactionData<V>,
    SignedTransactionMeta {}

/**
 * A signed state transaction
 */
export type SignedStateTransaction<V = unknown> = Transaction<
  SignedTransactionData<V>
>;

// =============================================================================
// MULTI-PARTY TRANSACTIONS
// =============================================================================

/**
 * Metadata for multi-party transactions (e.g., atomic swaps)
 */
export interface MultiPartyMeta {
  /** All signers */
  origins: string[];
  /** Corresponding signatures */
  sigs: string[];
  /** Optional: timestamps per signer */
  timestamps?: number[];
}

/**
 * Multi-party transaction data
 */
export interface MultiPartyTransactionData<V = unknown>
  extends TransactionData<V>,
    MultiPartyMeta {}

/**
 * A multi-party state transaction
 */
export type MultiPartyStateTransaction<V = unknown> = Transaction<
  MultiPartyTransactionData<V>
>;

// =============================================================================
// BLOCK TRANSACTIONS
// =============================================================================

/**
 * Block transaction data
 *
 * Blocks are transactions that reference other transactions.
 * This enables chains: each block references the previous.
 */
export interface BlockTransactionData {
  /** Previous block URI (chain link) */
  prev: string;
  /** URIs of transactions included in this block */
  txns: string[];
  /** State root (optional, for light clients) */
  stateRoot?: string;
  /** Timestamp */
  ts: number;
}

/**
 * Signed block transaction data
 */
export interface SignedBlockTransactionData extends BlockTransactionData {
  /** Validator/miner identity */
  origin: string;
  /** Block signature */
  sig: string;
  /** Stake reference (for PoS) */
  stake?: string;
  /** Slot reference (for slot-based consensus) */
  slot?: string;
}

/**
 * A block transaction
 */
export type BlockTransaction = Transaction<SignedBlockTransactionData>;

// =============================================================================
// VALIDATION TYPES
// =============================================================================

/**
 * Context for state validation
 * Extended from base ValidationContext with transaction-specific info
 */
export interface StateValidationContext {
  /** Read a URI's current value */
  read: <T = unknown>(uri: string) => Promise<ReadResult<T>>;
  /** The inputs from the current transaction */
  inputs: string[];
  /** The outputs from the current transaction */
  outputs: Array<[uri: string, value: unknown]>;
  /** The full transaction data */
  data: TransactionData;
}

/**
 * Program validator for outputs
 *
 * Similar to Schema validators but receives transaction context.
 * Used to validate that outputs conform to program rules.
 *
 * Example:
 * ```typescript
 * const blobValidator: ProgramValidator = async ({ uri, value, inputs, read }) => {
 *   // Check that a fee output exists
 *   const feeOutput = outputs.find(([u]) => u.startsWith("fees://"))
 *   if (!feeOutput) return { valid: false, error: "no_fee" }
 *
 *   // Calculate required fee
 *   const size = JSON.stringify(value).length
 *   const requiredFee = Math.ceil(size / 1024)
 *
 *   if (feeOutput[1] < requiredFee) {
 *     return { valid: false, error: "insufficient_fee" }
 *   }
 *
 *   return { valid: true }
 * }
 * ```
 */
export type ProgramValidator = (ctx: {
  /** The URI being validated */
  uri: string;
  /** The value at this URI */
  value: unknown;
  /** Read access to current state */
  read: <T = unknown>(uri: string) => Promise<ReadResult<T>>;
  /** Transaction inputs */
  inputs: string[];
  /** All transaction outputs (for checking siblings) */
  outputs: Array<[uri: string, value: unknown]>;
}) => Promise<ValidationResult>;

/**
 * Schema for program validators
 * Maps protocol://hostname to validators
 */
export type ProgramSchema = Record<string, ProgramValidator>;

// =============================================================================
// STATE VALIDATOR CONFIG
// =============================================================================

/**
 * Configuration for creating a state validator
 */
export interface StateValidatorConfig {
  /**
   * Program schema for output validation
   * Maps URI prefixes to validators
   */
  schema?: ProgramSchema;

  /**
   * Signature verification function
   */
  verifySignature?: (
    signature: string,
    message: string,
    publicKey: string,
  ) => Promise<boolean>;

  /**
   * How to extract the message to sign from a transaction
   * Default: JSON.stringify([uri, { inputs, outputs }])
   */
  extractMessage?: (tx: StateTransaction) => string;

  /**
   * Whether inputs must exist (UTXO model) or just be referenced (account model)
   * Default: false (inputs are references, not strict existence checks)
   */
  requireInputsExist?: boolean;

  /**
   * Custom input validator
   * Called for each input URI
   */
  validateInput?: (
    uri: string,
    read: <T = unknown>(uri: string) => Promise<ReadResult<T>>,
    txData: TransactionData,
  ) => Promise<ValidationResult>;

  /**
   * Custom output validator
   * Called after program validation for each output
   */
  validateOutput?: (
    uri: string,
    value: unknown,
    ctx: StateValidationContext,
  ) => Promise<ValidationResult>;
}

// =============================================================================
// UTXO TYPES
// =============================================================================

/**
 * UTXO (Unspent Transaction Output) record
 */
export interface UTXORecord<V = unknown> {
  /** The value of this UTXO */
  value: V;
  /** Who owns this UTXO */
  owner: string;
  /** Transaction that created this UTXO */
  createdBy: string;
  /** Whether this UTXO has been spent */
  spent: boolean;
  /** Transaction that spent this UTXO (if spent) */
  spentBy?: string;
}

/**
 * UTXO validator configuration
 */
export interface UTXOValidatorConfig {
  /** Extract owner from URI (e.g., "utxo://alice/1" -> "alice") */
  extractOwner: (uri: string) => string;
  /** Extract owner from transaction (the signer) */
  extractSigner: (tx: StateTransaction) => string;
  /** Check if signer can spend an input */
  canSpend?: (
    signer: string,
    owner: string,
    uri: string,
    value: unknown,
  ) => boolean;
}

// =============================================================================
// LIFECYCLE TYPES
// =============================================================================

/**
 * Transaction lifecycle stages as URIs
 *
 * The design uses URIs to represent lifecycle stages:
 * - txn://alice/42 (raw transaction)
 * - validated://node-a/txn/alice/42 (node attestation)
 * - included://firecat/block/1000/txn/alice/42 (in a block)
 * - confirmed://firecat/txn/alice/42 (N confirmations)
 */
export interface TransactionLifecycle {
  /** The raw transaction URI */
  txn: string;
  /** Node attestation URIs */
  validated?: string[];
  /** Block inclusion URI */
  included?: string;
  /** Confirmation URI */
  confirmed?: string;
}

/**
 * Node attestation data
 */
export interface NodeAttestation {
  /** Reference to the original transaction */
  txn: string;
  /** Hash of the transaction for verification */
  txnHash: string;
  /** Node's signature */
  nodeSig: string;
  /** Timestamp */
  ts: number;
}

/**
 * Block inclusion data
 */
export interface BlockInclusion {
  /** Block URI */
  block: string;
  /** Position in the block */
  position: number;
}

/**
 * Confirmation data
 */
export interface ConfirmationRecord {
  /** Block that confirmed this transaction */
  block: string;
  /** Number of confirmations */
  confirmations: number;
  /** Timestamp of confirmation */
  ts: number;
}
