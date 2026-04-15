/**
 * FirecatDataClient — backwards-compatible re-export of DataClient.
 *
 * The envelope-aware client logic now lives in b3nd-core as `DataClient`.
 * This module re-exports it under the original name for consumers of
 * @firecat/protocol who depend on the FirecatDataClient name.
 */

export { DataClient as FirecatDataClient } from "../b3nd-core/data-client.ts";
