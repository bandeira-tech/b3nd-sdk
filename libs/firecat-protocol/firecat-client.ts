/**
 * FirecatDataClient — backwards-compatible re-export of MessageDataClient.
 *
 * The envelope-aware client logic now lives in b3nd-core as
 * `MessageDataClient`. This module re-exports it under the original
 * name for consumers of @firecat/protocol who depend on the
 * FirecatDataClient name.
 */

export { MessageDataClient as FirecatDataClient } from "../b3nd-core/message-data-client.ts";
