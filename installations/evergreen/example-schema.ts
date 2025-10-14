import type { Schema } from "../../sdk/src/types.ts";

const schema: Schema = {
  "test://": () => Promise.resolve({ valid: true }),
};

export default schema;
