/**
 * @module
 * B3nd Message Layer
 *
 * The message primitive is [uri, values, data] where data is always
 * { inputs: string[], outputs: Output[] }.
 *
 * Use `message()` and `send()` from the data submodule for content-addressed
 * message construction and submission.
 */

// Types (Message re-exported from b3nd-core)
export type {
  Message,
  /** @deprecated Use Rig (L6) */
  MessageNode,
  /** @deprecated Use Rig (L6) */
  MessageNodeConfig,
  /** @deprecated Use Program from b3nd-core */
  MessageValidator,
  SubmitResult,
} from "./node-types.ts";

// Node implementation (deprecated)
export {
  /** @deprecated Use Rig (L6) */
  createMessageNode,
} from "./node.ts";
