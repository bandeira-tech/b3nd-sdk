/// <reference lib="deno.ns" />
/**
 * @module
 * whisper CLI.
 *
 *     deno run -A cli.ts profile "Alice"
 *     deno run -A cli.ts lookup <pubkey>
 *     deno run -A cli.ts send <recipient-pubkey> "hi!"
 *     deno run -A cli.ts inbox
 */

import { connection, Identity, Rig } from "@b3nd/rig";
import { HttpClient } from "@bandeira-tech/b3nd-sdk";
import { Whisper } from "./mod.ts";

const NODE_URL = Deno.env.get("SHARENET_NODE_URL") ?? "http://localhost:9942";
const SEED = Deno.env.get("USER_SEED") ?? "whisper-demo-user";

async function main() {
  const http = new HttpClient({ url: NODE_URL });
  const rig = new Rig({
    connections: [connection(http, { receive: ["*"], read: ["*"] })],
  });
  const identity = await Identity.fromSeed(SEED);
  const app = new Whisper(rig, identity);

  const [cmd, ...args] = Deno.args;
  switch (cmd) {
    case "profile":
      console.log(await app.setProfile(args.join(" ") || "Anonymous"));
      break;
    case "lookup":
      console.log(await app.lookupProfile(args[0]));
      break;
    case "send": {
      const recipient = await app.lookupProfile(args[0]);
      if (!recipient) throw new Error("recipient has no profile yet");
      console.log(await app.send(recipient, args.slice(1).join(" ")));
      break;
    }
    case "inbox":
      for (const msg of await app.inbox()) {
        console.log(`[${msg.sentAt}] ${msg.from.slice(0, 8)}…: ${msg.text}`);
      }
      break;
    default:
      console.error(`unknown command: ${cmd}`);
      Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
