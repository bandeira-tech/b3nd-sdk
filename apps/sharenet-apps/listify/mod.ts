/**
 * @module
 * listify — a list-management sample app on the sharenet protocol.
 *
 * Every user owns a private collection of lists stored as signed per-user
 * mutable writes. The index (`lists/_index`) tracks the set of lists;
 * each list lives at `lists/{listId}`. Items are mutated in place — the
 * app is deliberately chatty so you can watch small-write replication
 * under load.
 */

import { Identity, Rig } from "@b3nd/rig";
import { SharenetSession } from "@sharenet/protocol";

export interface ListItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
}

export interface TodoList {
  id: string;
  name: string;
  items: ListItem[];
  updatedAt: string;
}

interface ListIndex {
  lists: Array<{ id: string; name: string }>;
}

export class Listify {
  private readonly s: SharenetSession;

  constructor(rig: Rig, identity: Identity) {
    this.s = new SharenetSession(rig, "listify", identity);
  }

  async createList(name: string): Promise<TodoList> {
    const list: TodoList = {
      id: crypto.randomUUID(),
      name,
      items: [],
      updatedAt: new Date().toISOString(),
    };
    await this.s.setItem(`lists/${list.id}`, list);

    const index = (await this.s.getItem<ListIndex>("lists/_index")) ??
      { lists: [] };
    index.lists.push({ id: list.id, name: list.name });
    await this.s.setItem("lists/_index", index);

    return list;
  }

  async addItem(listId: string, text: string): Promise<TodoList> {
    const list = await this.requireList(listId);
    list.items.push({
      id: crypto.randomUUID(),
      text,
      done: false,
      createdAt: new Date().toISOString(),
    });
    list.updatedAt = new Date().toISOString();
    await this.s.setItem(`lists/${listId}`, list);
    return list;
  }

  async toggleItem(listId: string, itemId: string): Promise<TodoList> {
    const list = await this.requireList(listId);
    const item = list.items.find((i) => i.id === itemId);
    if (!item) throw new Error(`listify: item ${itemId} not found`);
    item.done = !item.done;
    list.updatedAt = new Date().toISOString();
    await this.s.setItem(`lists/${listId}`, list);
    return list;
  }

  async renameList(listId: string, name: string): Promise<TodoList> {
    const list = await this.requireList(listId);
    list.name = name;
    list.updatedAt = new Date().toISOString();
    await this.s.setItem(`lists/${listId}`, list);

    const index = (await this.s.getItem<ListIndex>("lists/_index")) ??
      { lists: [] };
    const entry = index.lists.find((l) => l.id === listId);
    if (entry) entry.name = name;
    await this.s.setItem("lists/_index", index);

    return list;
  }

  async getList(listId: string): Promise<TodoList | null> {
    return this.s.getItem<TodoList>(`lists/${listId}`);
  }

  async listAll(): Promise<TodoList[]> {
    const index = (await this.s.getItem<ListIndex>("lists/_index")) ??
      { lists: [] };
    const results = await Promise.all(
      index.lists.map((l) => this.s.getItem<TodoList>(`lists/${l.id}`)),
    );
    return results.filter((l): l is TodoList => l !== null);
  }

  private async requireList(listId: string): Promise<TodoList> {
    const list = await this.s.getItem<TodoList>(`lists/${listId}`);
    if (!list) throw new Error(`listify: list ${listId} not found`);
    return list;
  }
}
