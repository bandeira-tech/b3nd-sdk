/**
 * @module
 * B3nd Message Layer
 *
 * The message primitive is [uri, values, data] where data is always
 * `{ inputs: string[], outputs: Output[] }`.
 *
 * Use `message()` and `send()` for content-addressed message
 * construction and submission.
 */

export * from "./data/mod.ts";
