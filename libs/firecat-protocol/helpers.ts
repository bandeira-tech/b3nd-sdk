/**
 * Envelope builders for immutable balance UTXO consensus.
 *
 * Convenience functions to construct unsigned/signed MessageData
 * envelopes for genesis claims and consensus records using immutable URIs.
 */

import type { Output } from "@bandeira-tech/b3nd-sdk/types";
import { createAuthenticatedMessageWithHex } from "@bandeira-tech/b3nd-sdk/encrypt";
import type { MessageData } from "@bandeira-tech/b3nd-sdk";
import { CONSENSUS_FEE, ROOT_KEY } from "./constants.ts";

/** Encode bytes to hex string */
function encodeHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Generate a random hex string for UTXO ID segments */
export function generateUtxoId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return encodeHex(bytes);
}

/**
 * Build an unsigned MessageData for a genesis claim.
 * Creates a genesis marker + initial balance UTXO.
 */
export function buildGenesisEnvelope(
  pubkey: string,
  amount = 1000,
): MessageData {
  const utxoId = generateUtxoId();
  return {
    inputs: [],
    outputs: [
      [`immutable://genesis/${pubkey}`, {}, true],
      [`immutable://balance/${pubkey}/${utxoId}`, {}, amount],
    ] as Output[],
  };
}

/**
 * Build a signed MessageData for a consensus record with gas payment.
 *
 * Output order matters: consumed marker, change, fee, and consensus record.
 * The fee balance uses the content hash as its UTXO ID:
 *   immutable://balance/{ROOT_KEY}/{contentHash} → CONSENSUS_FEE
 */
export async function buildConsensusEnvelope(opts: {
  contentHash: string;
  userPubKey: string;
  userPrivKeyHex: string;
  inputUtxoUri: string;
  inputAmount: number;
}): Promise<MessageData> {
  const { contentHash, userPubKey, userPrivKeyHex, inputUtxoUri, inputAmount } =
    opts;

  const changeId = generateUtxoId();
  const changeAmount = inputAmount - CONSENSUS_FEE;

  const payload = {
    inputs: [inputUtxoUri],
    outputs: [
      // 1. Consumed marker — references the input balance URI
      [
        `immutable://consumed/${
          inputUtxoUri.replace("immutable://balance/", "")
        }`,
        {},
        inputUtxoUri,
      ],
      // 2. Change back to user (if any)
      ...(changeAmount > 0
        ? [
          [`immutable://balance/${userPubKey}/${changeId}`, {}, changeAmount] as Output,
        ]
        : []),
      // 3. Fee to ROOT_KEY, keyed by content hash
      [`immutable://balance/${ROOT_KEY}/${contentHash}`, {}, CONSENSUS_FEE],
      // 4. Consensus record (last — validators read fee balance)
      [`consensus://record/${contentHash}`, {}, `hash://sha256/${contentHash}`],
    ] as Output[],
  };

  const signed = await createAuthenticatedMessageWithHex(
    payload,
    userPubKey,
    userPrivKeyHex,
  );
  return { auth: signed.auth, ...payload };
}
