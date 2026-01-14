import type { Schema } from "../../sdk/src/types.ts";
import {
  authValidation,
  createPubkeyBasedAccess,
} from "@bandeira-tech/b3nd-sdk/auth";
import { computeSha256, validateLinkValue } from "./validators.ts";

const schema: Schema = {
  "mutable://open": () => Promise.resolve({ valid: true }),
  "mutable://inbox": () => Promise.resolve({ valid: true }),
  "immutable://inbox": () => Promise.resolve({ valid: true }),

  "mutable://accounts": async ({ uri, value }) => {
    try {
      const getAccess = createPubkeyBasedAccess();
      const validator = authValidation(getAccess);
      const isValid = await validator({ uri, value });

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
      const isValid = await validator({ uri, value });

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

  // Content-addressed storage (blob://)
  "blob://open": async ({ uri, value }) => {
    try {
      const url = new URL(uri);
      const path = url.pathname;

      // Parse hash algorithm and value
      const match = path.match(/^\/([^:]+):(.+)$/);
      if (!match) {
        return {
          valid: false,
          error: "Invalid hash format. Expected /algorithm:hash",
        };
      }

      const [, algorithm, expectedHash] = match;

      // Currently only support sha256
      if (algorithm !== "sha256") {
        return {
          valid: false,
          error: `Unsupported hash algorithm: ${algorithm}`,
        };
      }

      // Validate hash format (64 hex characters for SHA256)
      if (!/^[a-f0-9]{64}$/i.test(expectedHash)) {
        return {
          valid: false,
          error: "Invalid SHA256 hash format (expected 64 hex chars)",
        };
      }

      // Compute actual hash
      const actualHash = await computeSha256(value);

      // Compare hashes
      if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
        return {
          valid: false,
          error: `Content hash mismatch: expected ${expectedHash}, got ${actualHash}`,
        };
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : "Validation error",
      };
    }
  },

  // Authenticated links (value is auth-wrapped URI)
  "link://accounts": async ({ uri, value }) => {
    try {
      // 1. Verify signature
      const getAccess = createPubkeyBasedAccess();
      const validator = authValidation(getAccess);
      const isValid = await validator({ uri, value });

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
