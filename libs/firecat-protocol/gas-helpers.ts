/**
 * Envelope builders for gas UTXO consensus.
 *
 * Convenience functions to construct unsigned MessageData envelopes
 * for gas genesis claims using gas:// URIs.
 */

import type { MessageData } from "@bandeira-tech/b3nd-sdk";
import { GAS_GENESIS_AMOUNT } from "./gas-constants.ts";

/** Encode bytes to hex string */
function encodeHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Generate a random hex string for gas UTXO ID segments */
export function generateGasUtxoId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return encodeHex(bytes);
}

/**
 * Build an unsigned MessageData for a gas genesis claim.
 * Creates a gas genesis marker + initial gas UTXO.
 */
export function buildGasGenesisEnvelope(
  pubkey: string,
  amount = GAS_GENESIS_AMOUNT,
): MessageData {
  const utxoId = generateGasUtxoId();
  return {
    payload: {
      inputs: [],
      outputs: [
        [`gas://genesis/${pubkey}`, true],
        [`gas://utxo/${pubkey}/${utxoId}`, amount],
      ],
    },
  };
}
