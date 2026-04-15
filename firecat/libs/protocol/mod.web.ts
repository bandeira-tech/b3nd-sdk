/**
 * @firecat/protocol — browser bundle entry point.
 *
 * Re-exports everything from the protocol for use in npm/Vite/React apps.
 * All imports use @bandeira-tech/b3nd-web (the npm package).
 */

// Schema (default export as named for bundler compatibility)
export { default as firecatSchema } from "./mod.ts";

// Client
export { FirecatDataClient } from "./firecat-client.ts";

// Validators
export {
  balanceValidator,
  consumedValidator,
  genesisValidator,
  consensusRecordValidator,
} from "./validators.ts";

// Helpers
export {
  buildConsensusEnvelope,
  buildGenesisEnvelope,
  generateUtxoId,
} from "./helpers.ts";

// Constants
export {
  CONSENSUS_FEE,
  GENESIS_AMOUNT,
  ROOT_KEY,
} from "./constants.ts";
