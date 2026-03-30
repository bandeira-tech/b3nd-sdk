/**
 * Immutable balance UTXO validators for Firecat consensus.
 *
 * Write-once balances at self-describing URIs:
 *   immutable://balance/{account}/{utxoId}   → number (write-once)
 *   immutable://consumed/{account}/{utxoId}  → URI ref to consumed balance
 *   immutable://genesis/{pubkey}             → true (one-time mint marker)
 *   consensus://record/{contentHash}         → URI ref to content hash
 *
 * Conservation and auth are enforced via the `message` context passed
 * from msgSchema. Validators that don't need envelope context ignore it.
 */

import type { ValidationFn } from "@bandeira-tech/b3nd-sdk/types";
import type { MessageData } from "@bandeira-tech/b3nd-sdk";
import { verify } from "@bandeira-tech/b3nd-sdk/encrypt";
import { ROOT_KEY, CONSENSUS_FEE } from "./constants.ts";

// ── Helpers ──────────────────────────────────────────────────────────

/** Extract {account} from immutable://balance/{account}/{utxoId} */
function extractBalanceAccount(uri: string): string | null {
  const match = uri.match(/^immutable:\/\/balance\/([^/]+)\//);
  return match ? match[1] : null;
}

/** Check if a MessageData envelope contains a genesis output */
function isGenesisEnvelope(msg: MessageData): boolean {
  return msg.payload.outputs.some(([uri]) =>
    uri.startsWith("immutable://genesis/")
  );
}

// ── Per-output validators ────────────────────────────────────────────

/**
 * Validator for immutable://balance program.
 *
 * Per-output checks:
 * - Value must be number > 0
 * - Write-once: URI must not already exist
 *
 * Envelope-level checks (when `message` present):
 * - Skip conservation for genesis envelopes
 * - Conservation: sum(input balances) >= sum(output balances)
 * - Auth: each input balance account must have a matching signature
 */
export const balanceValidator: ValidationFn = async ({ uri, value, read, message }) => {
  if (typeof value !== "number" || value <= 0) {
    return { valid: false, error: "Balance value must be a number > 0" };
  }

  // Write-once
  const existing = await read(uri);
  if (existing.success) {
    return { valid: false, error: "Balance already exists (immutable)" };
  }

  // Envelope-level conservation + auth
  if (message) {
    const msg = message as MessageData;

    // Genesis envelopes skip conservation
    if (isGenesisEnvelope(msg)) {
      return { valid: true };
    }

    // Read all input balance values
    let inputSum = 0;
    for (const inputUri of msg.payload.inputs) {
      const inputResult = await read<number>(inputUri);
      if (!inputResult.success || typeof inputResult.record?.data !== "number") {
        return { valid: false, error: `Input balance not found: ${inputUri}` };
      }
      inputSum += inputResult.record.data;
    }

    // Sum output balance values
    let outputSum = 0;
    for (const [outUri, outVal] of msg.payload.outputs) {
      if (outUri.startsWith("immutable://balance/") && typeof outVal === "number") {
        outputSum += outVal;
      }
    }

    // Conservation
    if (inputSum < outputSum) {
      return {
        valid: false,
        error: `Conservation violated: inputs (${inputSum}) < outputs (${outputSum})`,
      };
    }

    // Auth: each input balance account must have a matching signature
    if (msg.auth && msg.auth.length > 0) {
      for (const inputUri of msg.payload.inputs) {
        const account = extractBalanceAccount(inputUri);
        if (!account) continue;

        const hasAuth = await Promise.any(
          msg.auth.map(async (auth) => {
            if (auth.pubkey !== account) return false;
            return verify(auth.pubkey, auth.signature, msg.payload);
          }),
        ).catch(() => false);

        if (!hasAuth) {
          return { valid: false, error: `Missing valid signature for account: ${account}` };
        }
      }
    } else if (msg.payload.inputs.length > 0) {
      return { valid: false, error: "Signed envelope required when spending inputs" };
    }
  }

  return { valid: true };
};

/**
 * Validator for immutable://consumed program.
 *
 * - Write-once: prevents double-spend
 * - Value must be a string matching immutable://balance/{account}/{utxoId}
 * - The referenced balance must exist with value > 0
 * - The referenced balance URI must appear in message.payload.inputs
 */
export const consumedValidator: ValidationFn = async ({ uri, value, read, message }) => {
  // Write-once
  const existing = await read(uri);
  if (existing.success) {
    return { valid: false, error: "Already consumed (double-spend)" };
  }

  // Value must be a balance URI reference
  if (typeof value !== "string" || !value.match(/^immutable:\/\/balance\/[^/]+\/[^/]+$/)) {
    return { valid: false, error: "Consumed value must be a balance URI reference" };
  }

  // Referenced balance must exist with value > 0
  const balanceResult = await read<number>(value);
  if (!balanceResult.success || typeof balanceResult.record?.data !== "number" || balanceResult.record.data <= 0) {
    return { valid: false, error: `Referenced balance not found or empty: ${value}` };
  }

  // Referenced balance must appear in inputs
  if (message) {
    const msg = message as MessageData;
    if (!msg.payload.inputs.includes(value)) {
      return { valid: false, error: `Consumed balance must appear in inputs: ${value}` };
    }
  }

  return { valid: true };
};

/**
 * Validator for immutable://genesis program.
 *
 * - Write-once: must not already exist
 * - Value must be true
 */
export const genesisValidator: ValidationFn = async ({ uri, value, read }) => {
  if (value !== true) {
    return { valid: false, error: "Genesis value must be true" };
  }

  const existing = await read(uri);
  if (existing.success) {
    return { valid: false, error: "Genesis already claimed for this pubkey" };
  }

  return { valid: true };
};

/**
 * Validator for consensus://record program.
 *
 * - Value must be a string matching hash://sha256/{contentHash}
 * - Content must exist: read(value) → success
 * - Write-once: must not already exist
 * - Fee paid: immutable://balance/{ROOT_KEY}/{contentHash} must exist with value >= CONSENSUS_FEE
 */
export const consensusRecordValidator: ValidationFn = async ({ uri, value, read, message }) => {
  // Extract contentHash from URI: consensus://record/{contentHash}
  const url = URL.parse(uri);
  if (!url) return { valid: false, error: "Invalid consensus URI" };

  const contentHash = url.pathname.substring(1);
  if (!contentHash) {
    return { valid: false, error: "Missing content hash in consensus URI" };
  }

  // Value must be a hash URI reference
  if (typeof value !== "string" || value !== `hash://sha256/${contentHash}`) {
    return { valid: false, error: "Consensus record value must be the content hash URI" };
  }

  // Content must exist
  const contentResult = await read(value);
  if (!contentResult.success) {
    return { valid: false, error: "Referenced content hash does not exist" };
  }

  // Write-once
  const existing = await read(uri);
  if (existing.success) {
    return { valid: false, error: "Consensus record already exists (immutable)" };
  }

  // Fee paid at ROOT_KEY keyed by content hash
  // Check sibling outputs first (not yet written during validation), then storage
  const feeUri = `immutable://balance/${ROOT_KEY}/${contentHash}`;
  let feePaid = false;

  if (message) {
    const msg = message as MessageData;
    const feeOutput = msg.payload.outputs.find(([u]) => u === feeUri);
    if (feeOutput && typeof feeOutput[1] === "number" && feeOutput[1] >= CONSENSUS_FEE) {
      feePaid = true;
    }
  }

  if (!feePaid) {
    const feeResult = await read<number>(feeUri);
    if (feeResult.success && typeof feeResult.record?.data === "number" && feeResult.record.data >= CONSENSUS_FEE) {
      feePaid = true;
    }
  }

  if (!feePaid) {
    return { valid: false, error: `Gas fee not paid: expected ${CONSENSUS_FEE} at ${feeUri}` };
  }

  return { valid: true };
};
