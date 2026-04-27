/**
 * @module
 * B3nd Message Layer
 *
 * The message primitive is [uri, payload]. When the payload follows the
 * MessageData convention it is `{ inputs: string[], outputs: Output[] }`.
 *
 * Use `message()` and `send()` for content-addressed message
 * construction and submission.
 */

export * from "./data/mod.ts";
