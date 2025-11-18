import type { Schema } from "../../sdk/src/types.ts";
import {
  authValidation,
  createPubkeyBasedAccess,
} from "../../sdk/auth/mod.ts";

const schema: Schema = {
  "mutable://open": () => Promise.resolve({ valid: true }),

  "mutable://accounts": async ({ uri, value }) => {
    try {
      // Use pubkey-based access control: extract pubkey from URI path
      const getAccess = createPubkeyBasedAccess();
      const validator = authValidation(getAccess);

      // Call the validator with the expected format
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
      // Use pubkey-based access control: extract pubkey from URI path
      const getAccess = createPubkeyBasedAccess();
      const validator = authValidation(getAccess);

      // Call the validator with the expected format
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
};

export default schema;
