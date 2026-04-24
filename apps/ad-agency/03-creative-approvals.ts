/**
 * Prototype 3 — Sign-off chain for creative review.
 *
 * Scenario: before an ad goes live the agency wants a defensible paper
 * trail. Designer submits a draft, the account director reviews, the
 * client signs off. If a dispute ever lands, the agency hands over a
 * single URI and walks back the whole chain.
 *
 * Each step is `rig.receive()` with a signed payload in the data slot:
 *
 *   data = { payload, auth: { pubkey, signature } }
 *
 * Programs enforce three things:
 *
 *   1. The pubkey in the URI path must match the signer in `auth`.
 *   2. The signer must be on the trust list for that role.
 *   3. The previous link in the chain (referenced by hash) must exist.
 *
 * Why `rig.receive()` and not `session.send()`? Because the current
 * Rig only runs its `programs` pipeline on `receive()` —
 * `rig.send()` dispatches straight to the clients. If you want your
 * trust rules enforced, you run them on the receive side. (Flagged in
 * REPORT.md — for a 1.0 this is the kind of thing that should have
 * a dedicated cookbook entry.)
 *
 * Demonstrates:
 *   - multiple identities signing through the same Rig
 *   - programs that authorize writes against a trust list
 *   - cross-program reads for "step N+1 depends on step N"
 *   - hash URIs as stable identifiers for chain traversal
 */

import { connection, Identity, Rig } from "@b3nd/rig";
import { MemoryStore, MessageDataClient } from "@bandeira-tech/b3nd-sdk";
import type { Program } from "@bandeira-tech/b3nd-sdk/types";
import { computeSha256, generateHashUri } from "@bandeira-tech/b3nd-sdk/hash";
import { verify as edVerify } from "@bandeira-tech/b3nd-sdk/encrypt";
import { assertEquals } from "./_assert.ts";

// ── Signed-payload envelope ─────────────────────────────────────────
interface Signed<P> {
  payload: P;
  auth: { pubkey: string; signature: string };
}

// ── Approval payloads ───────────────────────────────────────────────
interface DraftCreative {
  projectSlug: string;
  concept: string;
  headline: string;
  notes: string;
  draftedBy: string;
}
interface DirectorApproval {
  draftUri: string;
  verdict: "approved" | "changes-requested";
  comments: string;
  reviewedBy: string;
}
interface ClientApproval {
  draftUri: string;
  directorUri: string;
  verdict: "approved" | "rejected";
  comments: string;
  approvedBy: string;
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Sign a payload with an identity and return the `Signed<P>` wrapper. */
async function sign<P>(id: Identity, payload: P): Promise<Signed<P>> {
  const auth = await id.sign(payload);
  return { payload, auth };
}

/** Program factory: a signer-check + optional upstream-exists check. */
function signedProgram<P>(
  isAuthorized: (writerPubkey: string) => boolean,
  upstreamLinkField?: (p: P) => string,
): Program {
  return async ([uri, , data], _upstream, read) => {
    // link://agency/approvals/<role>/<pubkey>/<hash>
    //   0     1    2        3         4       5        6
    const writerPubkey = uri.split("/")[5];
    if (!writerPubkey) {
      return { code: "rejected", error: `malformed URI: ${uri}` };
    }
    if (!isAuthorized(writerPubkey)) {
      return {
        code: "rejected",
        error: `${writerPubkey.slice(0, 10)}… is not authorized for this role`,
      };
    }
    const signed = data as Signed<P> | null;
    if (!signed?.auth || !signed.payload) {
      return { code: "rejected", error: "missing signed envelope" };
    }
    if (signed.auth.pubkey !== writerPubkey) {
      return {
        code: "rejected",
        error: "URI path pubkey does not match signer pubkey",
      };
    }
    const ok = await edVerify(
      signed.auth.pubkey,
      signed.auth.signature,
      signed.payload,
    );
    if (!ok) return { code: "rejected", error: "bad signature" };

    if (upstreamLinkField) {
      const upstreamUri = upstreamLinkField(signed.payload);
      const upstreamResult = await read(upstreamUri);
      if (!upstreamResult.success) {
        return {
          code: "rejected",
          error: `referenced upstream not found: ${upstreamUri}`,
        };
      }
    }
    return { code: "accepted" };
  };
}

async function main() {
  // ── Cast ───────────────────────────────────────────────────────────
  const designer = await Identity.fromSeed("ppc-designer-jamie");
  const director = await Identity.fromSeed("ppc-director-priya");
  const otherDirector = await Identity.fromSeed("ppc-director-eric");
  const stranger = await Identity.fromSeed("ppc-freelancer-lee"); // not on trust list
  const client = await Identity.fromSeed("rosies-bakery-rosie");

  const trustedDirectors = new Set([director.pubkey, otherDirector.pubkey]);
  const trustedClients = new Set([client.pubkey]);

  // ── Programs ───────────────────────────────────────────────────────
  // Any pubkey may publish a draft (but must sign it).
  const draftProgram: Program = async ([uri, , data]) => {
    // mutable://agency/drafts/<pubkey>/<hash>
    //    0     1    2      3      4       5
    const writerPubkey = uri.split("/")[4];
    const signed = data as Signed<DraftCreative>;
    if (!signed?.auth) {
      return { code: "rejected", error: "drafts must be signed" };
    }
    if (signed.auth.pubkey !== writerPubkey) {
      return { code: "rejected", error: "path pubkey must match signer" };
    }
    const ok = await edVerify(
      signed.auth.pubkey,
      signed.auth.signature,
      signed.payload,
    );
    return ok ? { code: "accepted" } : { code: "rejected", error: "bad signature" };
  };

  const directorProgram = signedProgram<DirectorApproval>(
    (pk) => trustedDirectors.has(pk),
    (p) => p.draftUri,
  );

  const clientProgram = signedProgram<ClientApproval>(
    (pk) => trustedClients.has(pk),
    (p) => p.directorUri, // requires director sign-off to already exist
  );

  // ── Rig ────────────────────────────────────────────────────────────
  const store = new MessageDataClient(new MemoryStore());
  const rig = new Rig({
    connections: [connection(store, { receive: ["*"], read: ["*"] })],
    programs: {
      "mutable://agency/drafts": draftProgram,
      "link://agency/approvals/director": directorProgram,
      "link://agency/approvals/client": clientProgram,
    },
  });

  // ── Step 1 — designer submits draft ────────────────────────────────
  const draft: DraftCreative = {
    projectSlug: "rosies-bakery/spring",
    concept: "Warm-tones lifestyle shot of weekend tasting queue.",
    headline: "Weekend Tastings — Gluten-Free Friendly",
    notes: "Legal cleared 'friendly' for public claims.",
    draftedBy: designer.pubkey,
  };
  const draftSigned = await sign(designer, draft);
  const draftHash = generateHashUri(await computeSha256(draftSigned));
  const draftUri = `mutable://agency/drafts/${designer.pubkey}/${
    draftHash.slice("hash://sha256/".length)
  }`;

  console.log("-- designer submits draft --");
  const [draftResult] = await rig.receive([[draftUri, {}, draftSigned]]);
  assertEquals(draftResult.accepted, true);
  console.log(`  draft recorded at ${draftUri.slice(0, 40)}…`);

  // ── Step 2 — director approves ─────────────────────────────────────
  const dirPayload: DirectorApproval = {
    draftUri,
    verdict: "approved",
    comments: "Looks good — ship it.",
    reviewedBy: director.pubkey,
  };
  const dirSigned = await sign(director, dirPayload);
  const dirHash = generateHashUri(await computeSha256(dirSigned));
  const dirUri = `link://agency/approvals/director/${director.pubkey}/${
    dirHash.slice("hash://sha256/".length)
  }`;

  console.log("\n-- director approves --");
  const [dirResult] = await rig.receive([[dirUri, {}, dirSigned]]);
  assertEquals(dirResult.accepted, true);
  console.log(`  director signed at ${dirUri.slice(0, 50)}…`);

  // ── Step 2b — stranger tries to pose as a director ─────────────────
  console.log("\n-- stranger tries to approve (must fail) --");
  const strangerPayload = { ...dirPayload, reviewedBy: stranger.pubkey };
  const strangerSigned = await sign(stranger, strangerPayload);
  const strangerHash = generateHashUri(await computeSha256(strangerSigned));
  const strangerUri = `link://agency/approvals/director/${stranger.pubkey}/${
    strangerHash.slice("hash://sha256/".length)
  }`;
  const [strangerResult] = await rig.receive([[strangerUri, {}, strangerSigned]]);
  assertEquals(strangerResult.accepted, false);
  console.log(`  rejected: ${strangerResult.error}`);

  // ── Step 2c — forged signature on director URI (must fail) ─────────
  console.log("\n-- forged signature (must fail) --");
  const forgedSigned: Signed<DirectorApproval> = {
    payload: dirPayload,
    auth: { pubkey: director.pubkey, signature: "00".repeat(64) },
  };
  const forgedUri = `link://agency/approvals/director/${director.pubkey}/forged`;
  const [forgedResult] = await rig.receive([[forgedUri, {}, forgedSigned]]);
  assertEquals(forgedResult.accepted, false);
  console.log(`  rejected: ${forgedResult.error}`);

  // ── Step 3 — client signs off ──────────────────────────────────────
  const clientPayload: ClientApproval = {
    draftUri,
    directorUri: dirUri,
    verdict: "approved",
    comments: "Love it, let's run it.",
    approvedBy: client.pubkey,
  };
  const clientSigned = await sign(client, clientPayload);
  const clientHash = generateHashUri(await computeSha256(clientSigned));
  const clientUri = `link://agency/approvals/client/${client.pubkey}/${
    clientHash.slice("hash://sha256/".length)
  }`;

  console.log("\n-- client approves --");
  const [clientResult] = await rig.receive([[clientUri, {}, clientSigned]]);
  assertEquals(clientResult.accepted, true);
  console.log(`  client signed at ${clientUri.slice(0, 50)}…`);

  // ── Step 3b — client signs off on a non-existent director URI ──────
  console.log("\n-- client references missing director (must fail) --");
  const bogusPayload: ClientApproval = {
    draftUri,
    directorUri: `link://agency/approvals/director/${director.pubkey}/ghost`,
    verdict: "approved",
    comments: "should fail",
    approvedBy: client.pubkey,
  };
  const bogusSigned = await sign(client, bogusPayload);
  const bogusHash = generateHashUri(await computeSha256(bogusSigned));
  const bogusUri = `link://agency/approvals/client/${client.pubkey}/${
    bogusHash.slice("hash://sha256/".length)
  }`;
  const [bogusResult] = await rig.receive([[bogusUri, {}, bogusSigned]]);
  assertEquals(bogusResult.accepted, false);
  console.log(`  rejected: ${bogusResult.error}`);

  // ── Chain traversal for a provenance report ───────────────────────
  console.log("\n-- provenance chain --");
  const clientRecord = await rig.readOrThrow<Signed<ClientApproval>>(clientUri);
  const dirRecord = await rig.readOrThrow<Signed<DirectorApproval>>(
    clientRecord.payload.directorUri,
  );
  const draftRecord = await rig.readOrThrow<Signed<DraftCreative>>(
    clientRecord.payload.draftUri,
  );
  console.log(
    `  draft    — ${draftRecord.auth.pubkey.slice(0, 10)}… "${
      draftRecord.payload.headline
    }"`,
  );
  console.log(
    `  director — ${dirRecord.auth.pubkey.slice(0, 10)}… verdict=${dirRecord.payload.verdict}`,
  );
  console.log(
    `  client   — ${clientRecord.auth.pubkey.slice(0, 10)}… verdict=${clientRecord.payload.verdict}`,
  );

  assertEquals(draftRecord.auth.pubkey, designer.pubkey);
  assertEquals(dirRecord.auth.pubkey, director.pubkey);
  assertEquals(clientRecord.auth.pubkey, client.pubkey);
  assertEquals(clientRecord.payload.verdict, "approved");

  console.log("\n✓ all approval assertions passed");
}

if (import.meta.main) {
  await main();
}
