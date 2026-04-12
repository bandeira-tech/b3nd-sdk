/**
 * @module
 * B3nd Message Node (deprecated)
 *
 * @deprecated Use Rig (L6) instead.
 */

export type {
  Message,
  /** @deprecated */
  MessageNode,
  /** @deprecated */
  MessageNodeConfig,
  /** @deprecated */
  MessageValidator,
  SubmitResult,
} from "./node-types.ts";

export {
  /** @deprecated */
  createMessageNode,
} from "./node.ts";
