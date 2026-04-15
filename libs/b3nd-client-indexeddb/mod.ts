/**
 * IndexedDB backend for b3nd.
 *
 * Browser IndexedDB Store implementation. Pure mechanical storage
 * with no protocol awareness — wrap with FirecatDataClient or SimpleClient
 * for NodeProtocolInterface.
 */

export { IndexedDBStore } from "./store.ts";
