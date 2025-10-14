import type { Schema } from "../../sdk/src/types.ts";

const schema: Schema = {
  "users://": async ({ value }) => {
    if (typeof value === "object" && value !== null && "name" in (value as any)) {
      return { valid: true };
    }
    return { valid: false, error: "users requires a name field" };
  },
  // Allow all values under test:// for E2E write-list-read
  "test://": async ({ value }) => {
    // accept any JSON value for tests
    try { JSON.stringify(value); } catch { return { valid: false, error: 'invalid json' }; }
    return { valid: true };
  },
};

export default schema;
