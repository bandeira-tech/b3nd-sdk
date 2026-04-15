/**
 * Immutable balance UTXO validators for Firecat consensus.
 *
 * Write-once balances at self-describing URIs:
 *   immutable://balance/{account}/{utxoId}   → number (write-once)
 *   immutable://consumed/{account}/{utxoId}  → URI ref to consumed balance
 *   immutable://genesis/{pubkey}             → true (one-time mint marker)
 *   consensus://record/{contentHash}         → URI ref to content hash
 *
 * All validators use the canonical signature:
 *   (output, upstream, read) => Promise<ValidationResult>
 *
 * - `output`   — the [uri, values, data] being validated
 * - `upstream` — the envelope that contains this output (or undefined for top-level)
 * - `read`     — storage lookup (only committed data)
 *
 * When upstream is present, validators can inspect its data (e.g. inputs,
 * outputs) for cross-output checks like conservation and auth.
 */

import type { Validator } from "@bandeira-tech/b3nd-sdk/types";
import type { MessageData } from "@bandeira-tech/b3nd-sdk";
import { verify } from "@bandeira-tech/b3nd-sdk/encrypt";
import { CONSENSUS_FEE, ROOT_KEY } from "./constants.ts";

// ── Helpers ──────────────────────────────────────────────────────────

/** Extract {account} from immutable://balance/{account}/{utxoId} */
function extractBalanceAccount(uri: string): string | null {
  const match = uri.match(/^immutable:\/\/balance\/([^/]+)\//);
  return match ? match[1] : null;
}

/** Check if a MessageData envelope contains a genesis output */
function isGenesisEnvelope(msg: MessageData): boolean {
  return msg.outputs.some(([uri]) =>
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
 * Envelope-level checks (when upstream present):
 * - Skip conservation for genesis envelopes
 * - Conservation: sum(input balances) >= sum(output balances)
 * - Auth: each input balance account must have a matching signature
 */
export const balanceValidator: Validator = async (
  [uri, , data],
  upstream,
  read,
) => {
  if (typeof data !== "number" || data <= 0) {
    return { valid: false, error: "Balance value must be a number > 0" };
  }

  // Write-once
  const existing = await read(uri);
  if (existing.success) {
    return { valid: false, error: "Balance already exists (immutable)" };
  }

  // Envelope-level conservation + auth
  if (upstream) {
    const [, , envelope] = upstream;
    const msg = envelope as MessageData;

    // Genesis envelopes skip conservation
    if (isGenesisEnvelope(msg)) {
      return { valid: true };
    }

    // Read all input balance values
    let inputSum = 0;
    for (const inputUri of msg.inputs) {
      const inputResult = await read<number>(inputUri);
      if (
        !inputResult.success || typeof inputResult.record?.data !== "number"
      ) {
        return { valid: false, error: `Input balance not found: ${inputUri}` };
      }
      inputSum += inputResult.record.data;
    }

    // Sum output balance values
    let outputSum = 0;
    for (const [outUri, , outData] of msg.outputs) {
      if (
        outUri.startsWith("immutable://balance/") && typeof outData === "number"
      ) {
        outputSum += outData;
      }
    }

    // Conservation
    if (inputSum < outputSum) {
      return {
        valid: false,
        error:
          `Conservation violated: inputs (${inputSum}) < outputs (${outputSum})`,
      };
    }

    // Auth: each input balance account must have a matching signature
    if (msg.auth && msg.auth.length > 0) {
      for (const inputUri of msg.inputs) {
        const account = extractBalanceAccount(inputUri);
        if (!account) continue;

        const hasAuth = await Promise.any(
          msg.auth.map(async (auth) => {
            if (auth.pubkey !== account) return false;
            return verify(auth.pubkey, auth.signature, { inputs: msg.inputs, outputs: msg.outputs });
          }),
        ).catch(() => false);

        if (!hasAuth) {
          return {
            valid: false,
            error: `Missing valid signature for account: ${account}`,
          };
        }
      }
    } else if (msg.inputs.length > 0) {
      return {
        valid: false,
        error: "Signed envelope required when spending inputs",
      };
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
 * - The referenced balance URI must appear in upstream's inputs
 */
export const consumedValidator: Validator = async (
  [uri, , data],
  upstream,
  read,
) => {
  // Write-once
  const existing = await read(uri);
  if (existing.success) {
    return { valid: false, error: "Already consumed (double-spend)" };
  }

  // Data must be a balance URI reference
  if (
    typeof data !== "string" ||
    !data.match(/^immutable:\/\/balance\/[^/]+\/[^/]+$/)
  ) {
    return {
      valid: false,
      error: "Consumed value must be a balance URI reference",
    };
  }

  // Referenced balance must exist with value > 0
  const balanceResult = await read<number>(data);
  if (
    !balanceResult.success || typeof balanceResult.record?.data !== "number" ||
    balanceResult.record.data <= 0
  ) {
    return {
      valid: false,
      error: `Referenced balance not found or empty: ${data}`,
    };
  }

  // Referenced balance must appear in inputs
  if (upstream) {
    const [, , envelope] = upstream;
    const msg = envelope as MessageData;
    if (!msg.inputs.includes(data)) {
      return {
        valid: false,
        error: `Consumed balance must appear in inputs: ${data}`,
      };
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
export const genesisValidator: Validator = async (
  [uri, , data],
  _upstream,
  read,
) => {
  if (data !== true) {
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
 * - Content must exist in storage
 * - Write-once: must not already exist
 * - Fee paid: looks for fee in upstream's sibling outputs (explicit)
 */
export const consensusRecordValidator: Validator = async (
  [uri, , data],
  upstream,
  read,
) => {
  // Extract contentHash from URI: consensus://record/{contentHash}
  const url = URL.parse(uri);
  if (!url) return { valid: false, error: "Invalid consensus URI" };

  const contentHash = url.pathname.substring(1);
  if (!contentHash) {
    return { valid: false, error: "Missing content hash in consensus URI" };
  }

  // Data must be a hash URI reference
  if (typeof data !== "string" || data !== `hash://sha256/${contentHash}`) {
    return {
      valid: false,
      error: "Consensus record value must be the content hash URI",
    };
  }

  // Content must exist (in storage — previously committed)
  const contentResult = await read(data);
  if (!contentResult.success) {
    return { valid: false, error: "Referenced content hash does not exist" };
  }

  // Write-once (check storage)
  const existing = await read(uri);
  if (existing.success) {
    return {
      valid: false,
      error: "Consensus record already exists (immutable)",
    };
  }

  // Fee paid at ROOT_KEY keyed by content hash
  // Explicit: look at sibling outputs in the upstream envelope
  const feeUri = `immutable://balance/${ROOT_KEY}/${contentHash}`;

  if (upstream) {
    const [, , envelope] = upstream;
    const msg = envelope as MessageData;
    const feeOutput = msg.outputs.find(([u]) => u === feeUri);
    if (
      feeOutput && typeof feeOutput[2] === "number" &&
      feeOutput[2] >= CONSENSUS_FEE
    ) {
      return { valid: true };
    }
  }

  // Fall back to storage (fee may have been committed in a prior transaction)
  const feeResult = await read<number>(feeUri);
  if (
    feeResult.success && typeof feeResult.record?.data === "number" &&
    feeResult.record.data >= CONSENSUS_FEE
  ) {
    return { valid: true };
  }

  return {
    valid: false,
    error: `Gas fee not paid: expected ${CONSENSUS_FEE} at ${feeUri}`,
  };
};
