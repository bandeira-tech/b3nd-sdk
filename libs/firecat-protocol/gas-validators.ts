/**
 * Gas UTXO validators for Firecat consensus.
 *
 * Write-once gas balances at self-describing URIs:
 *   gas://utxo/{account}/{utxoId}        -> number (write-once)
 *   gas://consumed/{account}/{utxoId}     -> URI ref to consumed gas UTXO
 *   gas://genesis/{pubkey}                -> true (one-time gas mint marker)
 *
 * Conservation and auth are enforced via the `message` context passed
 * from msgSchema. Gas conservation sums only gas://utxo outputs,
 * keeping it independent from immutable://balance outputs.
 */

import type { ValidationFn } from "@bandeira-tech/b3nd-sdk/types";
import type { MessageData } from "@bandeira-tech/b3nd-sdk";
import { verify } from "@bandeira-tech/b3nd-sdk/encrypt";

// -- Helpers -----------------------------------------------------------------

/** Extract {account} from gas://utxo/{account}/{utxoId} */
function extractGasAccount(uri: string): string | null {
  const match = uri.match(/^gas:\/\/utxo\/([^/]+)\//);
  return match ? match[1] : null;
}

/** Check if a MessageData envelope contains a gas genesis output */
function isGasGenesisEnvelope(msg: MessageData): boolean {
  return msg.payload.outputs.some(([uri]) =>
    uri.startsWith("gas://genesis/")
  );
}

// -- Per-output validators ---------------------------------------------------

/**
 * Validator for gas://utxo program.
 *
 * Per-output checks:
 * - Value must be number > 0
 * - Write-once: URI must not already exist
 *
 * Envelope-level checks (when `message` present):
 * - Skip conservation for gas genesis envelopes
 * - Conservation: sum(input gas UTXOs) >= sum(output gas UTXOs)
 * - Auth: each input gas account must have a matching signature
 */
export const gasUtxoValidator: ValidationFn = async ({ uri, value, read, message }) => {
  if (typeof value !== "number" || value <= 0) {
    return { valid: false, error: "Gas UTXO value must be a number > 0" };
  }

  // Write-once
  const existing = await read(uri);
  if (existing.success) {
    return { valid: false, error: "Gas UTXO already exists (immutable)" };
  }

  // Envelope-level conservation + auth
  if (message) {
    const msg = message as MessageData;

    // Genesis envelopes skip conservation
    if (isGasGenesisEnvelope(msg)) {
      return { valid: true };
    }

    // Read all input gas UTXO values
    let inputSum = 0;
    for (const inputUri of msg.payload.inputs) {
      if (!inputUri.startsWith("gas://utxo/")) continue;
      const inputResult = await read<number>(inputUri);
      if (!inputResult.success || typeof inputResult.record?.data !== "number") {
        return { valid: false, error: `Input gas UTXO not found: ${inputUri}` };
      }
      inputSum += inputResult.record.data;
    }

    // Sum output gas UTXO values (only gas://utxo outputs)
    let outputSum = 0;
    for (const [outUri, outVal] of msg.payload.outputs) {
      if (outUri.startsWith("gas://utxo/") && typeof outVal === "number") {
        outputSum += outVal;
      }
    }

    // Conservation
    if (inputSum < outputSum) {
      return {
        valid: false,
        error: `Gas conservation violated: inputs (${inputSum}) < outputs (${outputSum})`,
      };
    }

    // Auth: each input gas account must have a matching signature
    if (msg.auth && msg.auth.length > 0) {
      for (const inputUri of msg.payload.inputs) {
        if (!inputUri.startsWith("gas://utxo/")) continue;
        const account = extractGasAccount(inputUri);
        if (!account) continue;

        const hasAuth = await Promise.any(
          msg.auth.map(async (auth) => {
            if (auth.pubkey !== account) return false;
            return verify(auth.pubkey, auth.signature, msg.payload);
          }),
        ).catch(() => false);

        if (!hasAuth) {
          return { valid: false, error: `Missing valid signature for gas account: ${account}` };
        }
      }
    } else if (msg.payload.inputs.some((u) => u.startsWith("gas://utxo/"))) {
      return { valid: false, error: "Signed envelope required when spending gas inputs" };
    }
  }

  return { valid: true };
};

/**
 * Validator for gas://consumed program.
 *
 * - Write-once: prevents double-spend
 * - Value must be a string matching gas://utxo/{account}/{utxoId}
 * - The referenced gas UTXO must exist with value > 0
 * - The referenced gas UTXO URI must appear in message.payload.inputs
 */
export const gasConsumedValidator: ValidationFn = async ({ uri, value, read, message }) => {
  // Write-once
  const existing = await read(uri);
  if (existing.success) {
    return { valid: false, error: "Gas already consumed (double-spend)" };
  }

  // Value must be a gas UTXO URI reference
  if (typeof value !== "string" || !value.match(/^gas:\/\/utxo\/[^/]+\/[^/]+$/)) {
    return { valid: false, error: "Gas consumed value must be a gas://utxo URI reference" };
  }

  // Referenced gas UTXO must exist with value > 0
  const utxoResult = await read<number>(value);
  if (!utxoResult.success || typeof utxoResult.record?.data !== "number" || utxoResult.record.data <= 0) {
    return { valid: false, error: `Referenced gas UTXO not found or empty: ${value}` };
  }

  // Referenced gas UTXO must appear in inputs
  if (message) {
    const msg = message as MessageData;
    if (!msg.payload.inputs.includes(value)) {
      return { valid: false, error: `Consumed gas UTXO must appear in inputs: ${value}` };
    }
  }

  return { valid: true };
};

/**
 * Validator for gas://genesis program.
 *
 * - Write-once: must not already exist
 * - Value must be true
 */
export const gasGenesisValidator: ValidationFn = async ({ uri, value, read }) => {
  if (value !== true) {
    return { valid: false, error: "Gas genesis value must be true" };
  }

  const existing = await read(uri);
  if (existing.success) {
    return { valid: false, error: "Gas genesis already claimed for this pubkey" };
  }

  return { valid: true };
};
