import type { Schema } from "../../sdk/src/types.ts";

const schema: Schema = {
  "test://write-test": () => Promise.resolve({ valid: true }),
  "test://read-test": () => Promise.resolve({ valid: true }),
  "test://list-test": () => Promise.resolve({ valid: true }),
  "test://auth-test": () => Promise.resolve({ valid: true }),
  "test://encrypt-test": () => Promise.resolve({ valid: true }),
  "test://signed-encrypted-test": () => Promise.resolve({ valid: true }),
};

export default schema;
