/**
 * LocalStorage backend for b3nd.
 *
 * Browser localStorage Store implementation. Pure mechanical storage
 * with no protocol awareness — wrap with FirecatDataClient or SimpleClient
 * for NodeProtocolInterface.
 */

export { LocalStorageStore } from "./store.ts";
