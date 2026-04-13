/**
 * @firecat/protocol — Firecat consensus protocol schema and utilities.
 *
 * Default export is the full Firecat schema for use with B3nd nodes.
 * Named exports provide validators, helpers, and constants.
 */

import type { Schema } from "@bandeira-tech/b3nd-sdk/types";
import {
  authValidation,
  createPubkeyBasedAccess,
} from "@bandeira-tech/b3nd-sdk/auth";
import { hashValidator, validateLinkValue } from "@bandeira-tech/b3nd-sdk/hash";
import {
  balanceValidator,
  consensusRecordValidator,
  consumedValidator,
  genesisValidator,
} from "./validators.ts";

const schema: Schema = {
  "mutable://open": async () => ({ valid: true }),
  "mutable://inbox": async () => ({ valid: true }),
  "immutable://inbox": async () => ({ valid: true }),

  "mutable://accounts": async ([uri, , data], upstream) => {
    try {
      if (!upstream) {
        return { valid: false, error: "Auth required: no upstream message" };
      }
      const [, , msgData] = upstream;
      const msg = msgData as import("@bandeira-tech/b3nd-sdk").MessageData;
      // Reconstruct auth format expected by authValidation
      const authValue = { auth: msg.auth || [], payload: { inputs: msg.inputs, outputs: msg.outputs } };
      const getAccess = createPubkeyBasedAccess();
      const validator = authValidation(getAccess);
      // deno-lint-ignore no-explicit-any
      const isValid = await validator({ uri, value: authValue } as any);

      return {
        valid: isValid,
        error: isValid ? undefined : "Signature verification failed",
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : "Validation error",
      };
    }
  },

  "immutable://open": async ([uri], _upstream, read) => {
    const result = await read(uri);
    return { valid: !result.success };
  },

  "immutable://accounts": async ([uri, , data], upstream, read) => {
    try {
      if (!upstream) {
        return { valid: false, error: "Auth required: no upstream message" };
      }
      const [, , msgData] = upstream;
      const msg = msgData as import("@bandeira-tech/b3nd-sdk").MessageData;
      // Reconstruct auth format expected by authValidation
      const authValue = { auth: msg.auth || [], payload: { inputs: msg.inputs, outputs: msg.outputs } };
      const getAccess = createPubkeyBasedAccess();
      const validator = authValidation(getAccess);
      // deno-lint-ignore no-explicit-any
      const isValid = await validator({ uri, value: authValue } as any);

      if (isValid) {
        const result = await read(uri);

        return {
          valid: !result.success,
          ...(result.success ? { error: "immutable object exists" } : {}),
        };
      }

      return {
        valid: isValid,
        error: isValid ? undefined : "Signature verification failed",
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : "Validation error",
      };
    }
  },

  // Content-addressed storage — hash enforcement via hashValidator()
  "hash://sha256": hashValidator(),

  // Immutable balance UTXO, consumed, genesis, and consensus programs
  "immutable://balance": balanceValidator,
  "immutable://consumed": consumedValidator,
  "immutable://genesis": genesisValidator,
  "consensus://record": consensusRecordValidator,

  // Authenticated links — auth checked from upstream message
  "link://accounts": async ([uri, , data], upstream) => {
    try {
      if (!upstream) {
        return { valid: false, error: "Auth required: no upstream message" };
      }
      const [, , msgData] = upstream;
      const msg = msgData as import("@bandeira-tech/b3nd-sdk").MessageData;
      // Reconstruct auth format expected by authValidation
      const authValue = { auth: msg.auth || [], payload: { inputs: msg.inputs, outputs: msg.outputs } };
      const getAccess = createPubkeyBasedAccess();
      const validator = authValidation(getAccess);
      // deno-lint-ignore no-explicit-any
      const isValid = await validator({ uri, value: authValue } as any);

      if (!isValid) {
        return { valid: false, error: "Signature verification failed" };
      }

      // Validate data as link URI
      return validateLinkValue(data);
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : "Validation error",
      };
    }
  },

  // Unauthenticated links (data is just a string URI)
  "link://open": async ([_uri, , data]) => {
    try {
      return validateLinkValue(data);
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : "Validation error",
      };
    }
  },
};

export default schema;

// Re-export all named exports
export * from "./validators.ts";
export * from "./helpers.ts";
export * from "./constants.ts";
