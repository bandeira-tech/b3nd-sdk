// Message node (Level 1) — new names
export type {
  Message,
  MessageNode,
  MessageNodeConfig,
  MessageValidator,
  SubmitResult,
} from "./node-mod.ts";
export { createMessageNode } from "./node-mod.ts";

// Deprecated aliases
export type {
  Transaction,
  TransactionNode,
  TransactionNodeConfig,
  TransactionValidator,
} from "./node-mod.ts";
export { createTransactionNode } from "./node-mod.ts";

// Message data convention (Level 2) — new names
export type {
  MessageData,
  MessageValidationContext,
  ProgramSchema,
  ProgramValidator,
  StateMessage,
} from "./data/mod.ts";
export { isMessageData } from "./data/mod.ts";

// Deprecated aliases
export type {
  StateTransaction,
  TransactionData,
  TransactionValidationContext,
} from "./data/mod.ts";
export { isTransactionData } from "./data/mod.ts";

// Validators
export {
  combineValidators,
  createOutputValidator,
  extractProgram,
} from "./data/mod.ts";
