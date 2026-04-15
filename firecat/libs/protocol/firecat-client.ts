/**
 * FirecatDataClient — Firecat's re-export of MessageDataClient.
 *
 * The envelope-aware client logic lives in @bandeira-tech/b3nd-sdk
 * as `MessageDataClient`. This module re-exports it under the
 * Firecat name for consumers of @firecat/protocol.
 */

export { MessageDataClient as FirecatDataClient } from "@bandeira-tech/b3nd-sdk";
