/**
 * @module
 * whisper — end-to-end encrypted chat on the sharenet protocol.
 *
 *   mutable://sharenet/whisper/users/{sender}/profile      (encrypted-to-self)
 *   mutable://sharenet/whisper/shared/{sender}/inbox/{recipient}/{msgId}
 *
 * Messages are encrypted for the recipient's X25519 key before being
 * written to the sender's shared-feed slot. Anyone can see that a
 * message was sent (the URI is public) but only the recipient can
 * decrypt the body. The receiver scans the whole shared feed for URIs
 * addressed to their pubkey.
 *
 * This exercises the encryption path, the shared feed, and (if multiple
 * backends are configured) the read-after-write replication path — a
 * recipient reading from a replica must still see every message their
 * peers sent.
 */

import { Identity, Rig } from "@b3nd/rig";
import { SharenetSession } from "@sharenet/protocol";

export interface Profile {
  displayName: string;
  encryptionPubkey: string;
  updatedAt: string;
}

export interface WhisperMessage {
  id: string;
  from: string;
  to: string;
  text: string;
  sentAt: string;
}

export class Whisper {
  private readonly s: SharenetSession;

  constructor(rig: Rig, identity: Identity) {
    this.s = new SharenetSession(rig, "whisper", identity);
  }

  get pubkey(): string {
    return this.s.pubkey;
  }

  /** Publish a public (non-encrypted) profile so peers can find our X25519 key. */
  async setProfile(displayName: string): Promise<Profile> {
    const profile: Profile = {
      displayName,
      encryptionPubkey: this.s.encryptionPubkey,
      updatedAt: new Date().toISOString(),
    };
    await this.s.setShared("profile", profile);
    return profile;
  }

  async lookupProfile(pubkey: string): Promise<Profile | null> {
    const all = await this.s.listShared<Profile>();
    return all.find((e) =>
      e.pubkey === pubkey && isProfilePath(e.uri)
    )?.data ?? null;
  }

  /** Encrypt and send a chat message to `recipient`. */
  async send(recipient: Profile, text: string): Promise<WhisperMessage> {
    const msg: WhisperMessage = {
      id: crypto.randomUUID(),
      from: this.pubkey,
      to: recipient.encryptionPubkey,
      text,
      sentAt: new Date().toISOString(),
    };
    const path = `inbox/${stripZeroX(recipient.encryptionPubkey)}/${msg.id}`;
    await this.s.sendEncryptedTo(recipient.encryptionPubkey, path, msg);
    return msg;
  }

  /**
   * Decrypt every message addressed to this identity's encryption pubkey.
   *
   * Returns messages sorted newest-first. Callers should persist their
   * own "last seen" cursor — this method re-scans the whole feed.
   */
  async inbox(): Promise<WhisperMessage[]> {
    const feed = await this.s.session.rig.read(
      `mutable://sharenet/whisper/shared/`,
    );
    const mine = feed.filter((r) =>
      r.success && r.uri && inboxMatchesMe(r.uri, this.s.encryptionPubkey)
    );
    const decrypted: WhisperMessage[] = [];
    for (const entry of mine) {
      try {
        const msg = await this.s.session.readEncrypted<WhisperMessage>(
          entry.uri!,
        );
        if (msg) decrypted.push(msg);
      } catch {
        // skip unreadable entries — not ours, or replication-in-flight
      }
    }
    return decrypted.sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  }
}

function isProfilePath(uri: string): boolean {
  try {
    const u = new URL(uri);
    const segs = u.pathname.split("/").filter(Boolean);
    // {appId}/shared/{pubkey}/profile
    return segs[3] === "profile";
  } catch {
    return false;
  }
}

function inboxMatchesMe(uri: string, myEncPubkey: string): boolean {
  try {
    const u = new URL(uri);
    const segs = u.pathname.split("/").filter(Boolean);
    // {appId}/shared/{sender}/inbox/{recipient}/{msgId}
    return segs[3] === "inbox" &&
      segs[4]?.toLowerCase() === stripZeroX(myEncPubkey).toLowerCase();
  } catch {
    return false;
  }
}

function stripZeroX(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}
