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
  consumedValidator,
  genesisValidator,
  consensusRecordValidator,
  pendingValidator,
  attestationValidator,
  rejectionValidator,
} from "./validators.ts";

const schema: Schema = {
  "mutable://open": () => Promise.resolve({ valid: true }),
  "mutable://inbox": () => Promise.resolve({ valid: true }),
  "immutable://inbox": () => Promise.resolve({ valid: true }),

  "mutable://accounts": async ({ uri, value }) => {
    try {
      const getAccess = createPubkeyBasedAccess();
      const validator = authValidation(getAccess);
      // deno-lint-ignore no-explicit-any
      const isValid = await validator({ uri, value } as any);

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

  "immutable://open": async ({ uri, value, read }) => {
    const result = await read(uri);
    return Promise.resolve({ valid: !result.success });
  },

  "immutable://accounts": async ({ uri, value, read }) => {
    try {
      const getAccess = createPubkeyBasedAccess();
      const validator = authValidation(getAccess);
      // deno-lint-ignore no-explicit-any
      const isValid = await validator({ uri, value } as any);

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

  // Pre-confirmation validators
  "immutable://pending": pendingValidator,
  "immutable://attestation": attestationValidator,
  "immutable://rejection": rejectionValidator,

  // Authenticated links (value is auth-wrapped URI)
  "link://accounts": async ({ uri, value }) => {
    try {
      // 1. Verify signature
      const getAccess = createPubkeyBasedAccess();
      const validator = authValidation(getAccess);
      // deno-lint-ignore no-explicit-any
      const isValid = await validator({ uri, value } as any);

      if (!isValid) {
        return { valid: false, error: "Signature verification failed" };
      }

      // 2. Extract payload and validate as link URI
      const payload = typeof value === "object" && value && "payload" in value
        ? (value as { payload: unknown }).payload
        : value;
      return validateLinkValue(payload);
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : "Validation error",
      };
    }
  },

  // Unauthenticated links (value is just a string URI)
  "link://open": async ({ uri, value }) => {
    try {
      return validateLinkValue(value);
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
