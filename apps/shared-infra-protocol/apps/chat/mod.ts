/**
 * @module
 * chat — a shared group-chat sample app.
 *
 * Exercises write-heavy + log-heavy patterns:
 *
 *   - rooms are shared docs at `mutable://app/chat/shared/rooms/{roomId}`
 *   - messages are append-only log entries at
 *     `log://app/chat/events/rooms/{roomId}/{timestamp}-{uuid}` — write-once
 *     paths guarantee ordered, tamper-resistant history
 *   - message bodies are also pushed to `hash://sha256/{…}` so large messages
 *     don't blow the per-path quota and so multiple apps can reference the
 *     same content
 *   - per-user presence lives under the signed `/users/{pubkey}/presence`
 *     path — only the user themselves can set it
 *
 * Each `postMessage()` call issues a single envelope with three outputs
 * (hash, log, presence update). That's the "ring-to-store-to-replication"
 * path the stress tests hammer on.
 */

import { AppClient, type UserSession } from "../../sdk/mod.ts";

export const CHAT_APP_ID = "chat";

export interface Room {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  author: string;
  text: string;
  at: number;
  hashUri: string;
}

export interface Presence {
  pubkey: string;
  status: "online" | "away" | "offline";
  at: number;
}

export class Chat {
  constructor(readonly session: UserSession) {}

  static async connect(
    opts: { nodeUrl: string; identity: UserSession["identity"] } | {
      app: AppClient;
      identity: UserSession["identity"];
    },
  ): Promise<Chat> {
    const app = "app" in opts ? opts.app : new AppClient({
      nodeUrl: opts.nodeUrl,
      appId: CHAT_APP_ID,
    });
    await app.register({
      name: "Chat",
      description: "Append-only rooms, content-addressed messages",
    }).catch(() => {});
    return new Chat(app.withIdentity(opts.identity));
  }

  // ── Room management (shared namespace) ─────────────────────────────

  async createRoom(name: string, description?: string): Promise<Room> {
    const id = crypto.randomUUID();
    const room: Room = { id, name, description, createdAt: Date.now() };
    await this.session.app.putShared(`rooms/${id}`, room);
    return room;
  }

  async getRoom(id: string): Promise<Room | undefined> {
    return await this.session.app.getShared<Room>(`rooms/${id}`);
  }

  async listRooms(): Promise<Room[]> {
    const items = await this.session.app.client.read(
      `mutable://app/${CHAT_APP_ID}/shared/rooms/`,
    );
    return items
      .map((i) => i.record?.data as Room | undefined)
      .filter((r): r is Room => !!r && typeof r === "object" && "id" in r);
  }

  // ── Messaging ──────────────────────────────────────────────────────

  async postMessage(roomId: string, text: string): Promise<ChatMessage> {
    const id = crypto.randomUUID();
    const at = Date.now();
    // Store body content-addressed so big messages get deduped across rooms.
    const body = { text, author: this.session.pubkey, at };
    const hashUri = await this.session.app.putContent(body);

    // Append to the write-once log — path is monotonic so entries sort.
    const logPath = `rooms/${roomId}/${
      String(at).padStart(16, "0")
    }-${id}`;
    await this.session.app.appendLog(logPath, {
      id,
      roomId,
      author: this.session.pubkey,
      text,
      at,
      hashUri,
    });

    return { id, roomId, author: this.session.pubkey, text, at, hashUri };
  }

  async history(roomId: string, limit = 100): Promise<ChatMessage[]> {
    const rows = await this.session.app.listLog(`rooms/${roomId}`);
    const msgs = rows
      .map((r) => r.data as ChatMessage)
      .filter((m): m is ChatMessage => !!m && typeof m === "object" && "text" in m)
      .sort((a, b) => a.at - b.at);
    return msgs.slice(-limit);
  }

  // ── Presence (user-scoped, signed) ────────────────────────────────

  async setPresence(status: Presence["status"]): Promise<void> {
    await this.session.saveDoc(`presence`, {
      pubkey: this.session.pubkey,
      status,
      at: Date.now(),
    });
  }

  async myPresence(): Promise<Presence | undefined> {
    return await this.session.readDoc<Presence>(`presence`);
  }
}
