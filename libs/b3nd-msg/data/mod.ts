/**
 * @module
 * B3nd Message Data Convention
 *
 * In the new primitive, data is always { inputs: string[], outputs: Output[] }.
 * This is not optional — every message carries this shape.
 *
 * ## The Convention
 *
 * ```typescript
 * // data is always:
 * {
 *   inputs: string[],                             // URIs consumed/referenced
 *   outputs: [uri, values, data][]                // Output 3-tuples
 * }
 * ```
 *
 * @example UTXO-style transfer using send()
 * ```typescript
 * import { send } from "@bandeira-tech/b3nd-sdk";
 *
 * await send({
 *   inputs: ["utxo://alice/1"],
 *   outputs: [
 *     ["utxo://bob/99", { fire: 50 }, null],
 *     ["utxo://alice/2", { fire: 30 }, null],
 *     ["fees://pool", { fire: 1 }, null],
 *   ],
 * }, client);
 * ```
 */

// Types
export type {
  MessageData,
  /** @deprecated Use Program from b3nd-core */
  MessageValidationContext,
  /** @deprecated Use Record<string, Program> from b3nd-core */
  ProgramSchema,
  /** @deprecated Use Program from b3nd-core */
  ProgramValidator,
  StateMessage,
} from "./types.ts";

// Validators (deprecated — use Programs instead)
export {
  /** @deprecated */
  combineValidators,
  /** @deprecated */
  createOutputValidator,
  extractProgram,
} from "./validators.ts";

// Detection (deprecated — data is always { inputs, outputs })
export {
  /** @deprecated Data is always { inputs, outputs } */
  isMessageData,
} from "./detect.ts";

// Content-addressed message constructor + sender
export { message } from "./message.ts";
export { send, type SendResult } from "./send.ts";
