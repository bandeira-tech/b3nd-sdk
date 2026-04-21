/**
 * @module
 * list-manager — a sample app for the shared-infra protocol.
 *
 * Exercises:
 *   - app registration on first run
 *   - per-user ownership via signed envelopes (`/users/{pubkey}/…`)
 *   - mutable list documents (one doc per list, stored at a user path)
 *   - append-only audit log (`log://app/list-manager/events/…`)
 *
 * Pattern: each user owns a handful of *lists*; a list is a small JSON
 * document of `{ id, title, items: [{ id, text, done, at }] }`. Every
 * mutation rewrites the doc and emits a log entry so we can rebuild the
 * timeline from the log alone (useful for replication/audit stress tests).
 */

import { AppClient, type UserSession } from "../../sdk/mod.ts";

export const LIST_MANAGER_APP_ID = "list-manager";

export interface ListItem {
  id: string;
  text: string;
  done: boolean;
  at: number;
}

export interface List {
  id: string;
  title: string;
  items: ListItem[];
  updatedAt: number;
}

export class ListManager {
  constructor(readonly session: UserSession) {}

  static async connect(
    opts: { nodeUrl: string; session: UserSession["identity"] } | {
      app: AppClient;
      identity: UserSession["identity"];
    },
  ): Promise<ListManager> {
    const app = "app" in opts ? opts.app : new AppClient({
      nodeUrl: opts.nodeUrl,
      appId: LIST_MANAGER_APP_ID,
    });
    const identity = "identity" in opts ? opts.identity : opts.session;
    // Register lazily — it's a no-op if the record already exists
    // (the registry program will just overwrite its own record).
    await app.register({
      name: "List Manager",
      description: "Simple shared-infra sample app",
    }).catch(() => {});
    return new ListManager(app.withIdentity(identity));
  }

  private path(listId: string) {
    return `lists/${listId}`;
  }

  async createList(title: string): Promise<List> {
    const id = crypto.randomUUID();
    const list: List = { id, title, items: [], updatedAt: Date.now() };
    await this.session.saveDoc(this.path(id), list as any);
    await this.session.app.appendLog(
      `user/${this.session.pubkey}/${id}/${list.updatedAt}`,
      { type: "list.created", listId: id, title, at: list.updatedAt },
    );
    return list;
  }

  async getList(listId: string): Promise<List | undefined> {
    return await this.session.readDoc<List>(this.path(listId));
  }

  async listLists(): Promise<List[]> {
    const docs = await this.session.listMyDocs();
    return docs
      .map((d) => {
        const payload = (d.data as { payload?: List } | undefined)?.payload;
        return payload;
      })
      .filter((l): l is List => !!l && typeof l === "object" && "items" in l);
  }

  async addItem(listId: string, text: string): Promise<List> {
    const list = await this.getList(listId);
    if (!list) throw new Error(`List not found: ${listId}`);
    const item: ListItem = {
      id: crypto.randomUUID(),
      text,
      done: false,
      at: Date.now(),
    };
    list.items.push(item);
    list.updatedAt = Date.now();
    await this.session.saveDoc(this.path(listId), list as any);
    await this.session.app.appendLog(
      `user/${this.session.pubkey}/${listId}/${list.updatedAt}`,
      { type: "item.added", listId, itemId: item.id, text, at: item.at },
    );
    return list;
  }

  async toggleItem(listId: string, itemId: string): Promise<List> {
    const list = await this.getList(listId);
    if (!list) throw new Error(`List not found: ${listId}`);
    const item = list.items.find((i) => i.id === itemId);
    if (!item) throw new Error(`Item not found: ${itemId}`);
    item.done = !item.done;
    list.updatedAt = Date.now();
    await this.session.saveDoc(this.path(listId), list as any);
    await this.session.app.appendLog(
      `user/${this.session.pubkey}/${listId}/${list.updatedAt}`,
      {
        type: "item.toggled",
        listId,
        itemId,
        done: item.done,
        at: list.updatedAt,
      },
    );
    return list;
  }

  async deleteList(listId: string): Promise<void> {
    // We don't support deletion at the protocol level — we just overwrite
    // with a tombstone. Apps filter tombstones when listing.
    const list = await this.getList(listId);
    if (!list) return;
    const tomb: List = {
      ...list,
      title: "(deleted)",
      items: [],
      updatedAt: Date.now(),
    };
    await this.session.saveDoc(this.path(listId), tomb as any);
    await this.session.app.appendLog(
      `user/${this.session.pubkey}/${listId}/${tomb.updatedAt}`,
      { type: "list.deleted", listId, at: tomb.updatedAt },
    );
  }
}
