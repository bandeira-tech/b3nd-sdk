/**
 * Prototype 1 — Encrypted client brief intake.
 *
 * Scenario: Pixel & Pine Creative (a five-person ad agency) wants small
 * local clients to submit new-project briefs online. Briefs contain
 * sensitive commercial information (budgets, existing vendor contracts,
 * planned product launches) that must not sit in plaintext in the
 * agency's database.
 *
 * The agency publishes a public "intake card" at a predictable URI —
 * slug, display name, encryption public key, inbox pattern. A client in
 * their own browser generates a throwaway identity, encrypts their brief
 * to the agency's encryption key, and drops it in the inbox. The
 * agency's session decrypts on read.
 *
 * Parties:
 *   - agency   — long-lived identity, derived from a seed
 *   - bakery   — small-client #1, fresh identity per session
 *   - dentist  — small-client #2, fresh identity per session
 */

import { connection, Identity, Rig } from "@b3nd/rig";
import { MemoryStore, MessageDataClient } from "@bandeira-tech/b3nd-sdk";
import { assertEquals } from "./_assert.ts";

// ── Intake card (public) ─────────────────────────────────────────────
interface IntakeCard {
  agencyName: string;
  agencyPubkey: string;
  encryptionPubkey: string;
  inboxPrefix: string;
}

// ── Brief (encrypted end-to-end) ──────────────────────────────────────
interface Brief {
  clientSlug: string;
  submittedBy: string;
  contactEmail: string;
  budgetUsd: number;
  launchWindow: string;
  description: string;
}

async function main() {
  // One shared Rig backed by memory. In production this is the agency's
  // server: Postgres + HTTP, with clients talking to it over HttpClient.
  const store = new MessageDataClient(new MemoryStore());
  const rig = new Rig({
    connections: [connection(store, { receive: ["*"], read: ["*"] })],
    // Reaction stands in for "ping #new-briefs in Slack".
    reactions: {
      "mutable://agency/clients/:slug/inbox/:briefId": (_uri, _data, params) => {
        console.log(
          `  [notify] new brief ${params.briefId} for ${params.slug}`,
        );
      },
    },
  });

  // ── Agency boots, publishes its intake cards ───────────────────────
  const agency = await Identity.fromSeed("pixel-and-pine-agency-seed-2026");
  const agencySession = agency.rig(rig);

  console.log(`Agency pubkey: ${agency.pubkey.slice(0, 12)}…`);
  console.log(`Agency enc key: ${agency.encryptionPubkey.slice(0, 12)}…`);

  const clients = [
    { slug: "rosies-bakery", displayName: "Rosie's Bakery" },
    { slug: "bridge-street-dental", displayName: "Bridge Street Dental" },
  ];

  for (const c of clients) {
    const card: IntakeCard = {
      agencyName: "Pixel & Pine Creative",
      agencyPubkey: agency.pubkey,
      encryptionPubkey: agency.encryptionPubkey,
      inboxPrefix: `mutable://agency/clients/${c.slug}/inbox/`,
    };

    // Public meta — anyone can read, signed by the agency.
    await agencySession.send({
      inputs: [],
      outputs: [[
        `mutable://agency/clients/${c.slug}/intake/meta`,
        {},
        card,
      ]],
    });
  }

  // ── Client side (browser, fresh identity) ──────────────────────────
  async function submitBrief(clientSlug: string, brief: Brief) {
    // The client reads the public intake card to discover the agency's
    // encryption key. They do not need to trust anything about the
    // transport — a compromised Rig still cannot decrypt.
    const card = await rig.readOrThrow<IntakeCard>(
      `mutable://agency/clients/${clientSlug}/intake/meta`,
    );

    const submitter = await Identity.generate();
    const session = submitter.rig(rig);

    // sendEncrypted → X25519 to the agency's pubkey + Ed25519-signed.
    const briefId = crypto.randomUUID();
    const result = await session.sendEncrypted(
      {
        inputs: [],
        outputs: [[
          `${card.inboxPrefix}${briefId}`,
          {},
          brief,
        ]],
      },
      card.encryptionPubkey,
    );

    return { briefId, submitterPubkey: submitter.pubkey, result };
  }

  const bakeryBrief: Brief = {
    clientSlug: "rosies-bakery",
    submittedBy: "Rosie Chen",
    contactEmail: "rosie@rosiesbakery.example",
    budgetUsd: 4_500,
    launchWindow: "2026-Q3",
    description:
      "Launch of a gluten-free sourdough line; need Instagram + local radio spots.",
  };
  const dentistBrief: Brief = {
    clientSlug: "bridge-street-dental",
    submittedBy: "Dr. Amaya Okafor",
    contactEmail: "amaya@bridgestdental.example",
    budgetUsd: 12_000,
    launchWindow: "2026-Q2",
    description:
      "New-patient promotion; existing contract with MediaCorp runs out in May.",
  };

  console.log("\n-- Clients submit briefs --");
  const bakerySubmit = await submitBrief("rosies-bakery", bakeryBrief);
  const dentistSubmit = await submitBrief(
    "bridge-street-dental",
    dentistBrief,
  );

  assertEquals(bakerySubmit.result.accepted, true);
  assertEquals(dentistSubmit.result.accepted, true);

  // Drain the reactions so the notification prints before the next section.
  await Promise.allSettled(rig.drain());

  // ── Agency reads its inboxes ───────────────────────────────────────
  console.log("\n-- Agency reviews inboxes --");
  for (const c of clients) {
    const inboxPrefix = `mutable://agency/clients/${c.slug}/inbox/`;
    const count = await rig.count(inboxPrefix);
    console.log(`  ${c.slug}: ${count} brief${count === 1 ? "" : "s"}`);

    const listed = await rig.read(inboxPrefix);
    for (const item of listed) {
      if (!item.success || !item.uri) continue;
      const plaintext = await agencySession.readEncrypted<Brief>(item.uri);
      if (!plaintext) throw new Error(`could not decrypt ${item.uri}`);
      console.log(
        `    from ${plaintext.submittedBy}  $${plaintext.budgetUsd}  — ${
          plaintext.description.slice(0, 60)
        }…`,
      );
    }
  }

  // ── Assertions (treat this file as an integration test) ────────────
  const bakeryBriefUri =
    `mutable://agency/clients/rosies-bakery/inbox/${bakerySubmit.briefId}`;
  const decrypted = await agencySession.readEncrypted<Brief>(bakeryBriefUri);
  assertEquals(decrypted?.contactEmail, bakeryBrief.contactEmail);
  assertEquals(decrypted?.budgetUsd, 4_500);

  // Inbox items live at `mutable://…` — reading one with an identity
  // that cannot decrypt would still retrieve the EncryptedPayload shape,
  // but NOT the plaintext. Demonstrate that with a fresh third party.
  const eavesdropper = (await Identity.generate()).rig(rig);
  let threw = false;
  try {
    await eavesdropper.readEncrypted<Brief>(bakeryBriefUri);
  } catch {
    threw = true;
  }
  // The eavesdropper has an encryption private key (generate() makes
  // both pairs) but it is the wrong one — decrypt fails inside the
  // identity's decrypt() call and throws. That's exactly what we want.
  assertEquals(threw, true, "eavesdropper must not be able to decrypt");

  console.log("\n✓ all intake assertions passed");
}

if (import.meta.main) {
  await main();
}
