/// <reference lib="deno.ns" />
/**
 * @module
 * inkwell CLI.
 *
 *     deno run -A cli.ts publish my-slug "Title" "Body..."
 *     deno run -A cli.ts read my-slug
 *     deno run -A cli.ts feed
 */

import { connection, Identity, Rig } from "@b3nd/rig";
import { HttpClient } from "@bandeira-tech/b3nd-sdk";
import { Inkwell } from "./mod.ts";

const NODE_URL = Deno.env.get("SHARENET_NODE_URL") ?? "http://localhost:9942";
const SEED = Deno.env.get("USER_SEED") ?? "inkwell-demo-author";

async function main() {
  const http = new HttpClient({ url: NODE_URL });
  const rig = new Rig({
    connections: [connection(http, { receive: ["*"], read: ["*"] })],
  });
  const identity = await Identity.fromSeed(SEED);
  const ink = new Inkwell(rig, identity);

  const [cmd, ...args] = Deno.args;
  switch (cmd) {
    case "publish": {
      const [slug, title, ...body] = args;
      console.log(await ink.publish({
        slug,
        title,
        body: body.join(" "),
      }));
      break;
    }
    case "read":
      console.log(await ink.readOwn(args[0]));
      break;
    case "feed":
      for (const entry of await ink.feed()) {
        console.log(`${entry.publishedAt}  ${entry.slug}  — ${entry.title}`);
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
