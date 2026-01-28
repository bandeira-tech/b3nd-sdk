/**
 * @b3nd/txn-data - Inputs/Outputs Convention
 *
 * Level 2 of the transaction layer. This module provides:
 * - Standard transaction data structure with inputs/outputs
 * - State validator that understands inputs/outputs
 * - Program validators for outputs
 * - UTXO helpers
 *
 * Usage:
 * ```typescript
 * import { createStateValidator, StateTransaction } from "@b3nd/txn-data"
 *
 * const validator = createStateValidator({
 *   schema: {
 *     "utxo://": utxoValidator,
 *     "blob://": blobValidator,
 *   },
 *   verifySignature: ed25519Verify,
 * })
 *
 * const txn: StateTransaction = [
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

// Re-export types
export * from "./types.ts";

import type {
  TransactionValidator,
  ValidationContext,
  ValidationResult,
} from "../txn/types.ts";

import type {
  ProgramSchema,
  SignedTransactionData,
  StateTransaction,
  StateValidationContext,
  StateValidatorConfig,
  TransactionData,
  UTXORecord,
  UTXOValidatorConfig,
} from "./types.ts";

// =============================================================================
// STATE VALIDATOR
// =============================================================================

/**
 * Create a state validator for transactions with inputs/outputs
 *
 * This validator understands the inputs/outputs convention and can:
 * - Verify signatures
 * - Check that inputs exist (optional)
 * - Run program validators against outputs
 * - Enforce custom input/output validation
 *
 * @param config - Validator configuration
 * @returns A transaction validator
 *
 * @example
 * ```typescript
 * const validator = createStateValidator({
 *   schema: {
 *     "utxo://": async ({ uri, value, inputs, outputs }) => {
 *       // Validate UTXO output
 *       if (typeof value !== "number" || value <= 0) {
 *         return { valid: false, error: "invalid_amount" }
 *       }
 *       return { valid: true }
 *     },
 *     "fees://": async ({ value }) => {
 *       // Validate fee output
 *       if (typeof value !== "number" || value < 0) {
 *         return { valid: false, error: "invalid_fee" }
 *       }
 *       return { valid: true }
 *     }
 *   },
 *   verifySignature: async (sig, msg, pubkey) => {
 *     // Your signature verification
 *     return crypto.verify(sig, msg, pubkey)
 *   }
 * })
 * ```
 */
export function createStateValidator(
  config: StateValidatorConfig = {},
): TransactionValidator<TransactionData> {
  const {
    schema = {},
    verifySignature,
    extractMessage = defaultExtractMessage,
    requireInputsExist = false,
    validateInput,
    validateOutput,
  } = config;

  return async (
    tx: StateTransaction,
    ctx: ValidationContext,
  ): Promise<ValidationResult> => {
    const [uri, data] = tx;

    // Validate data structure
    if (!isTransactionData(data)) {
      return {
        valid: false,
        error: "invalid_transaction_data",
        details: { message: "Transaction must have inputs and outputs arrays" },
      };
    }

    const { inputs, outputs } = data;

    // Verify signature if verifySignature is provided and data has signature
    if (verifySignature && isSignedData(data)) {
      const message = extractMessage(tx);
      const valid = await verifySignature(data.sig, message, data.origin);
      if (!valid) {
        return {
          valid: false,
          error: "invalid_signature",
        };
      }
    }

    // Validate inputs
    for (const inputUri of inputs) {
      // Check input exists if required
      if (requireInputsExist) {
        const result = await ctx.read(inputUri);
        if (!result.success || !result.record) {
          return {
            valid: false,
            error: "input_not_found",
            details: { uri: inputUri },
          };
        }
      }

      // Custom input validation
      if (validateInput) {
        const result = await validateInput(inputUri, ctx.read, data);
        if (!result.valid) {
          return result;
        }
      }
    }

    // Create state validation context for output validators
    const stateCtx: StateValidationContext = {
      read: ctx.read,
      inputs,
      outputs,
      data,
    };

    // Validate outputs with program validators
    for (const [outputUri, value] of outputs) {
      // Find matching program validator
      const programKey = findProgramKey(outputUri, schema);
      if (programKey) {
        const validator = schema[programKey];
        const result = await validator({
          uri: outputUri,
          value,
          read: ctx.read,
          inputs,
          outputs,
        });
        if (!result.valid) {
          return {
            ...result,
            details: { ...result.details, outputUri },
          };
        }
      }

      // Custom output validation
      if (validateOutput) {
        const result = await validateOutput(outputUri, value, stateCtx);
        if (!result.valid) {
          return result;
        }
      }
    }

    return { valid: true };
  };
}

/**
 * Default message extraction for signing
 * Creates a deterministic string from the transaction
 */
function defaultExtractMessage(tx: StateTransaction): string {
  const [uri, data] = tx;
  // Exclude signature from the message
  const { inputs, outputs } = data;
  return JSON.stringify({ uri, inputs, outputs });
}

/**
 * Check if data has transaction structure
 */
function isTransactionData(data: unknown): data is TransactionData {
  return (
    data !== null &&
    typeof data === "object" &&
    "inputs" in data &&
    Array.isArray((data as TransactionData).inputs) &&
    "outputs" in data &&
    Array.isArray((data as TransactionData).outputs)
  );
}

/**
 * Check if data has signed structure
 */
function isSignedData(
  data: TransactionData,
): data is SignedTransactionData {
  return (
    "origin" in data &&
    typeof (data as SignedTransactionData).origin === "string" &&
    "sig" in data &&
    typeof (data as SignedTransactionData).sig === "string"
  );
}

/**
 * Find the program key that matches a URI
 * Keys are prefixes like "utxo://" or "mutable://accounts"
 */
function findProgramKey(
  uri: string,
  schema: ProgramSchema,
): string | undefined {
  // Sort by length descending to match most specific first
  const keys = Object.keys(schema).sort((a, b) => b.length - a.length);
  return keys.find((key) => uri.startsWith(key));
}

// =============================================================================
// UTXO HELPERS
// =============================================================================

/**
 * Create a UTXO validator
 *
 * Validates that:
 * - Inputs are unspent
 * - Signer owns the inputs
 * - Value is conserved (optional)
 *
 * @param config - UTXO validator configuration
 * @returns A state validator for UTXO transactions
 *
 * @example
 * ```typescript
 * const utxoValidator = createUTXOValidator({
 *   extractOwner: (uri) => uri.match(/utxo:\/\/([^/]+)/)?.[1] || "",
 *   extractSigner: (tx) => tx[1].origin,
 * })
 * ```
 */
export function createUTXOValidator(
  config: UTXOValidatorConfig,
): TransactionValidator<SignedTransactionData> {
  const { extractOwner, extractSigner, canSpend } = config;

  return async (tx, ctx): Promise<ValidationResult> => {
    const [uri, data] = tx;
    const signer = extractSigner(tx);

    // Check each input
    for (const inputUri of data.inputs) {
      // Read the input
      const result = await ctx.read<UTXORecord>(inputUri);
      if (!result.success || !result.record) {
        return {
          valid: false,
          error: "input_not_found",
          details: { uri: inputUri },
        };
      }

      const utxo = result.record.data;

      // Check if already spent
      if (utxo.spent) {
        return {
          valid: false,
          error: "input_already_spent",
          details: { uri: inputUri, spentBy: utxo.spentBy },
        };
      }

      // Check ownership
      const owner = extractOwner(inputUri);
      const allowed = canSpend
        ? canSpend(signer, owner, inputUri, utxo.value)
        : signer === owner;

      if (!allowed) {
        return {
          valid: false,
          error: "not_owner",
          details: { uri: inputUri, owner, signer },
        };
      }
    }

    return { valid: true };
  };
}

/**
 * Create a conservation validator
 *
 * Ensures that the sum of input values equals the sum of output values.
 * Useful for UTXO models where value must be conserved.
 *
 * @param extractInputValue - Function to extract value from an input record
 * @param extractOutputValue - Function to extract value from an output
 * @returns A state validator that checks conservation
 *
 * @example
 * ```typescript
 * const conservationValidator = createConservationValidator(
 *   (utxo) => utxo.value,
 *   (value) => value as number,
 * )
 * ```
 */
export function createConservationValidator(
  extractInputValue: (record: unknown) => number,
  extractOutputValue: (value: unknown) => number,
): TransactionValidator<TransactionData> {
  return async (tx, ctx): Promise<ValidationResult> => {
    const [, data] = tx;

    // Sum input values
    let inputSum = 0;
    for (const inputUri of data.inputs) {
      const result = await ctx.read(inputUri);
      if (!result.success || !result.record) {
        return {
          valid: false,
          error: "input_not_found",
          details: { uri: inputUri },
        };
      }
      inputSum += extractInputValue(result.record.data);
    }

    // Sum output values
    let outputSum = 0;
    for (const [, value] of data.outputs) {
      outputSum += extractOutputValue(value);
    }

    if (inputSum !== outputSum) {
      return {
        valid: false,
        error: "conservation_violated",
        details: { inputSum, outputSum, difference: inputSum - outputSum },
      };
    }

    return { valid: true };
  };
}

// =============================================================================
// TRANSACTION BUILDERS
// =============================================================================

/**
 * Build a state transaction
 *
 * Helper function to construct properly typed transactions.
 *
 * @example
 * ```typescript
 * const txn = buildTransaction({
 *   uri: "txn://alice/transfer/42",
 *   inputs: ["utxo://alice/1"],
 *   outputs: [
 *     ["utxo://bob/99", 50],
 *     ["utxo://alice/2", 30],
 *   ],
 * })
 * ```
 */
export function buildTransaction<V = unknown>(params: {
  uri: string;
  inputs: string[];
  outputs: Array<[string, V]>;
}): StateTransaction<V> {
  return [
    params.uri,
    {
      inputs: params.inputs,
      outputs: params.outputs,
    },
  ];
}

/**
 * Build a signed state transaction
 *
 * @example
 * ```typescript
 * const txn = buildSignedTransaction({
 *   uri: "txn://alice/transfer/42",
 *   origin: "alice",
 *   inputs: ["utxo://alice/1"],
 *   outputs: [
 *     ["utxo://bob/99", 50],
 *     ["utxo://alice/2", 30],
 *   ],
 *   sign: async (message) => crypto.sign(message, aliceKey),
 * })
 * ```
 */
export async function buildSignedTransaction<V = unknown>(params: {
  uri: string;
  origin: string;
  inputs: string[];
  outputs: Array<[string, V]>;
  sign: (message: string) => Promise<string>;
  nonce?: number | string;
  ts?: number;
}): Promise<StateTransaction<V & SignedTransactionData<V>>> {
  const { uri, origin, inputs, outputs, sign, nonce, ts = Date.now() } = params;

  // Create the message to sign
  const message = JSON.stringify({ uri, inputs, outputs });
  const sig = await sign(message);

  return [
    uri,
    {
      origin,
      sig,
      ts,
      nonce,
      inputs,
      outputs,
    } as TransactionData<V> & SignedTransactionData<V>,
  ];
}

// =============================================================================
// FEE HELPERS
// =============================================================================

/**
 * Calculate fee based on transaction size
 *
 * @param tx - The transaction
 * @param ratePerKB - Fee rate per kilobyte
 * @returns Required fee amount
 *
 * @example
 * ```typescript
 * const txn = buildTransaction({ ... })
 * const fee = calculateSizeFee(txn, 1) // 1 token per KB
 * ```
 */
export function calculateSizeFee(
  tx: StateTransaction,
  ratePerKB: number,
): number {
  const size = JSON.stringify(tx).length;
  return Math.ceil(size / 1024) * ratePerKB;
}

/**
 * Create a fee validator
 *
 * Ensures that a fee output exists with sufficient value.
 *
 * @param feePrefix - URI prefix for fee outputs (e.g., "fees://")
 * @param calculateRequiredFee - Function to calculate required fee
 * @returns A program validator for fee checking
 *
 * @example
 * ```typescript
 * const feeValidator = createFeeValidator(
 *   "fees://",
 *   (uri, value, outputs) => Math.ceil(JSON.stringify(outputs).length / 1024)
 * )
 * ```
 */
export function createFeeValidator(
  feePrefix: string,
  calculateRequiredFee: (
    uri: string,
    value: unknown,
    outputs: Array<[string, unknown]>,
  ) => number,
): TransactionValidator<TransactionData> {
  return async (tx): Promise<ValidationResult> => {
    const [, data] = tx;
    const { outputs } = data;

    // Find fee output
    const feeOutput = outputs.find(([uri]) => uri.startsWith(feePrefix));
    if (!feeOutput) {
      return {
        valid: false,
        error: "no_fee_output",
      };
    }

    const [feeUri, feeValue] = feeOutput;
    if (typeof feeValue !== "number") {
      return {
        valid: false,
        error: "invalid_fee_type",
      };
    }

    // Calculate required fee (excluding the fee output itself)
    const otherOutputs = outputs.filter(([uri]) => !uri.startsWith(feePrefix));
    const requiredFee = calculateRequiredFee(feeUri, feeValue, otherOutputs);

    if (feeValue < requiredFee) {
      return {
        valid: false,
        error: "insufficient_fee",
        details: { paid: feeValue, required: requiredFee },
      };
    }

    return { valid: true };
  };
}

// =============================================================================
// LIFECYCLE HELPERS
// =============================================================================

/**
 * Generate a validated:// URI for node attestation
 */
export function validatedUri(nodeId: string, txnUri: string): string {
  // txn://alice/42 -> validated://node-a/txn/alice/42
  const path = txnUri.replace("://", "/");
  return `validated://${nodeId}/${path}`;
}

/**
 * Generate an included:// URI for block inclusion
 */
export function includedUri(blockUri: string, txnUri: string): string {
  // txn://firecat/block/1000 + txn://alice/42 -> included://firecat/block/1000/txn/alice/42
  const blockPath = blockUri.replace("txn://", "");
  const txnPath = txnUri.replace("://", "/");
  return `included://${blockPath}/${txnPath}`;
}

/**
 * Generate a confirmed:// URI
 */
export function confirmedUri(chainId: string, txnUri: string): string {
  // txn://alice/42 -> confirmed://firecat/txn/alice/42
  const txnPath = txnUri.replace("://", "/");
  return `confirmed://${chainId}/${txnPath}`;
}

/**
 * Parse a lifecycle URI to extract components
 */
export function parseLifecycleUri(uri: string): {
  stage: "validated" | "included" | "confirmed" | "txn";
  nodeId?: string;
  blockUri?: string;
  chainId?: string;
  txnUri: string;
} | null {
  const match = uri.match(/^(\w+):\/\/(.+)$/);
  if (!match) return null;

  const [, protocol, path] = match;

  switch (protocol) {
    case "txn":
      return { stage: "txn", txnUri: uri };

    case "validated": {
      // validated://node-a/txn/alice/42 -> nodeId: node-a, txnUri: txn://alice/42
      const parts = path.split("/");
      const nodeId = parts[0];
      const txnProtocol = parts[1];
      const txnPath = parts.slice(2).join("/");
      return {
        stage: "validated",
        nodeId,
        txnUri: `${txnProtocol}://${txnPath}`,
      };
    }

    case "included": {
      // included://firecat/block/1000/txn/alice/42
      const txnIndex = path.indexOf("/txn/");
      if (txnIndex === -1) return null;
      const blockPath = path.slice(0, txnIndex);
      const txnPath = path.slice(txnIndex + 1);
      const [txnProtocol, ...rest] = txnPath.split("/");
      return {
        stage: "included",
        blockUri: `txn://${blockPath}`,
        txnUri: `${txnProtocol}://${rest.join("/")}`,
      };
    }

    case "confirmed": {
      // confirmed://firecat/txn/alice/42
      const parts = path.split("/");
      const chainId = parts[0];
      const txnProtocol = parts[1];
      const txnPath = parts.slice(2).join("/");
      return {
        stage: "confirmed",
        chainId,
        txnUri: `${txnProtocol}://${txnPath}`,
      };
    }

    default:
      return null;
  }
}
