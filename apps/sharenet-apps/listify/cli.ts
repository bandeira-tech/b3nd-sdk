/// <reference lib="deno.ns" />
/**
 * @module
 * listify CLI — a thin runner that drives the {@link Listify} app against
 * an operator-registered sharenet node. Useful for kicking the tires or
 * as a seed for app-level integration tests.
 *
 *     deno run -A cli.ts create "groceries"
 *     deno run -A cli.ts add <listId> "buy milk"
 *     deno run -A cli.ts show <listId>
 *     deno run -A cli.ts ls
 */

import { connection, Identity, Rig } from "@b3nd/rig";
import { HttpClient } from "@bandeira-tech/b3nd-sdk";
import { Listify } from "./mod.ts";

const NODE_URL = Deno.env.get("SHARENET_NODE_URL") ?? "http://localhost:9942";
const SEED = Deno.env.get("USER_SEED") ?? "listify-demo-user";

async function main() {
  const http = new HttpClient({ url: NODE_URL });
  const rig = new Rig({
    connections: [connection(http, { receive: ["*"], read: ["*"] })],
  });
  const identity = await Identity.fromSeed(SEED);
  const app = new Listify(rig, identity);

  const [cmd, ...args] = Deno.args;
  switch (cmd) {
    case "create":
      console.log(await app.createList(args[0] ?? "untitled"));
      break;
    case "add":
      console.log(await app.addItem(args[0], args.slice(1).join(" ")));
      break;
    case "toggle":
      console.log(await app.toggleItem(args[0], args[1]));
      break;
    case "rename":
      console.log(await app.renameList(args[0], args.slice(1).join(" ")));
      break;
    case "show":
      console.log(await app.getList(args[0]));
      break;
    case "ls":
      console.log(await app.listAll());
      break;
    default:
      console.error(`unknown command: ${cmd}`);
      Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
