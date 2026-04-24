/**
 * Prototype 2 — Campaign publishing with multi-channel fan-out.
 *
 * Scenario: The bakery's campaign is ready. A single publishing action
 * needs to:
 *   1. record the canonical creative at `hash://sha256/…` (immutable),
 *   2. advance the mutable pointer `mutable://agency/campaigns/<slug>/current`,
 *   3. dispatch a "publish ticket" to each ad channel the client has
 *      purchased — in this prototype Meta Ads and Google Ads.
 *
 * Each destination is a separate `connection()` with its own URI
 * pattern. A single `rig.receive()` call containing a batch of tuples
 * lets the Rig route each one to the matching connection.
 *
 * Note on `rig.receive()` vs `session.send()`:
 *   `session.send()` builds a `MessageData` envelope at a hash URI and
 *   dispatches that envelope to whichever connection accepts the hash
 *   URI. The envelope's outputs are then decomposed *locally* by the
 *   MessageDataClient into its own store — they never flow back through
 *   the Rig's per-URI routing. For cross-connection fan-out based on
 *   output URI patterns you therefore want `rig.receive()` with one
 *   tuple per destination. This finding is noted in REPORT.md.
 *
 * Demonstrates:
 *   - content-addressing a canonical artifact via computeSha256
 *   - mutable pointer for the "what's live now" fast path
 *   - multi-client broadcast via connection URI patterns
 *   - Rig-level reactions as internal observability
 *   - second rewrite that retains history via the hash URI
 */

import { connection, Identity, Rig } from "@b3nd/rig";
import {
  FunctionalClient,
  MemoryStore,
  MessageDataClient,
} from "@bandeira-tech/b3nd-sdk";
import type { Message, ReceiveResult } from "@bandeira-tech/b3nd-sdk/types";
import { computeSha256, generateHashUri } from "@bandeira-tech/b3nd-sdk/hash";
import { assertEquals } from "./_assert.ts";

// ── Campaign payload ────────────────────────────────────────────────
interface Campaign {
  clientSlug: string;
  headline: string;
  body: string;
  callToAction: string;
  goLiveDate: string;
  assets: string[];
  createdBy: string;
}

// ── Publish ticket (what each ad channel sees) ──────────────────────
interface PublishTicket {
  clientSlug: string;
  campaignHash: string;
  channel: "meta" | "google";
  runDateUtc: string;
  dailyBudgetUsd: number;
}

/** Mock ad channel — captures tickets and replays them for assertions. */
function mockAdChannel(channelName: "meta" | "google") {
  const published: Array<{ uri: string; ticket: PublishTicket }> = [];
  const client = new FunctionalClient({
    receive: (msgs: Message[]) => {
      const results: ReceiveResult[] = [];
      for (const [uri, , data] of msgs) {
        const ticket = data as PublishTicket;
        console.log(
          `  [${channelName}] accepted ticket ${
            ticket.campaignHash.slice(14, 24)
          }… — $${ticket.dailyBudgetUsd}/day, live ${ticket.runDateUtc}`,
        );
        published.push({ uri, ticket });
        results.push({ accepted: true });
      }
      return Promise.resolve(results);
    },
    status: () =>
      Promise.resolve({
        status: "healthy",
        schema: [`publish://${channelName}`],
      }),
  });
  return { client, published };
}

async function main() {
  // ── Rig topology ───────────────────────────────────────────────────
  const primary = new MessageDataClient(new MemoryStore());
  const meta = mockAdChannel("meta");
  const google = mockAdChannel("google");

  const publishedUris: string[] = [];

  const rig = new Rig({
    connections: [
      // Primary store keeps the canonical record and the mutable pointer.
      connection(primary, {
        receive: ["mutable://*", "hash://*"],
        read: ["mutable://*", "hash://*"],
      }),
      // Each publisher only accepts its own URI namespace.
      connection(meta.client, { receive: ["publish://meta/*"] }),
      connection(google.client, { receive: ["publish://google/*"] }),
    ],
    reactions: {
      // Internal audit — e.g., write a row in the agency's activity log.
      "mutable://agency/campaigns/:slug/current": (uri, data, params) => {
        publishedUris.push(uri);
        console.log(
          `  [audit] campaign for ${params.slug} now pointing at ${
            (data as string).slice(14, 24)
          }…`,
        );
      },
    },
  });

  const agency = await Identity.fromSeed("pixel-and-pine-agency-seed-2026");

  async function publishCampaign(slug: string, v: Campaign) {
    const hashUri = generateHashUri(await computeSha256(v));
    const now = Date.now();
    const ticketMeta: PublishTicket = {
      clientSlug: slug,
      campaignHash: hashUri,
      channel: "meta",
      runDateUtc: v.goLiveDate + "T07:00:00Z",
      dailyBudgetUsd: 25,
    };
    const ticketGoogle: PublishTicket = { ...ticketMeta, channel: "google" };

    const results = await rig.receive([
      [hashUri, {}, v],                                             // → primary
      [`mutable://agency/campaigns/${slug}/current`, {}, hashUri],  // → primary
      [`publish://meta/${slug}/${now}`, {}, ticketMeta],            // → meta only
      [`publish://google/${slug}/${now + 1}`, {}, ticketGoogle],    // → google only
    ]);
    for (const [i, r] of results.entries()) {
      if (!r.accepted) {
        throw new Error(`publish step ${i} failed: ${r.error}`);
      }
    }
    return { hashUri };
  }

  // ── Draft v1 ───────────────────────────────────────────────────────
  const slug = "rosies-bakery";
  const v1: Campaign = {
    clientSlug: slug,
    headline: "Now at Rosie's: Crackling Gluten-Free Sourdough",
    body:
      "Wood-fired, naturally leavened, tested by gluten-free neighbours. Weekend tastings free.",
    callToAction: "Pre-order for pickup",
    goLiveDate: "2026-05-01",
    assets: ["asset://bakery/hero-loaf.webp", "asset://bakery/storefront.webp"],
    createdBy: agency.pubkey,
  };

  console.log("-- Publishing v1 --");
  const { hashUri: v1Hash } = await publishCampaign(slug, v1);
  console.log(`  canonical: ${v1Hash.slice(0, 24)}…`);
  await Promise.allSettled(rig.drain());

  // ── Draft v2 — replace headline, keep audit trail ──────────────────
  console.log("\n-- Publishing v2 (headline tweak) --");
  const v2: Campaign = {
    ...v1,
    headline: "Rosie's Weekend Sourdough Tastings — Gluten-Free Friendly",
    goLiveDate: "2026-05-08",
  };
  const { hashUri: v2Hash } = await publishCampaign(slug, v2);
  console.log(`  canonical: ${v2Hash.slice(0, 24)}…`);
  await Promise.allSettled(rig.drain());

  // ── Verify ─────────────────────────────────────────────────────────
  // Pointer advanced to v2
  const currentHash = await rig.readOrThrow<string>(
    `mutable://agency/campaigns/${slug}/current`,
  );
  assertEquals(currentHash, v2Hash);

  // v1 still retrievable by its hash (audit trail intact)
  const v1Restored = await rig.readOrThrow<Campaign>(v1Hash);
  assertEquals(v1Restored.headline, v1.headline);

  // Each publisher got 2 tickets (v1 + v2)
  assertEquals(meta.published.length, 2);
  assertEquals(google.published.length, 2);
  assertEquals(meta.published[1].ticket.campaignHash, v2Hash);
  assertEquals(google.published[1].ticket.campaignHash, v2Hash);

  // Sanity: ticket URIs are NOT reachable through the Rig's read side —
  // meta/google connections declare no `read` pattern, and the primary's
  // read pattern covers only mutable:// and hash://. That's exactly the
  // filtering guarantee that `connection()` provides.
  const sampleTicketUri = meta.published[0].uri;
  const [stray] = await rig.read(sampleTicketUri);
  assertEquals(stray.success, false);

  // Audit reaction fired twice (once per publish).
  assertEquals(publishedUris.length, 2);

  console.log("\n✓ all publish assertions passed");
}

if (import.meta.main) {
  await main();
}
