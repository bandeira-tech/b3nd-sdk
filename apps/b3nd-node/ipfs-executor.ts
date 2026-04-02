// IPFS executor for IpfsClient using the Kubo HTTP RPC API.
// This module is installation-specific so the core SDK stays decoupled from
// any concrete IPFS library. Talks to Kubo's /api/v0/* endpoints.

import type { IpfsExecutor } from "../../libs/b3nd-client-ipfs/mod.ts";

export function createIpfsExecutor(apiUrl: string): IpfsExecutor {
  const base = apiUrl.replace(/\/+$/, "");

  return {
    async add(content: string): Promise<string> {
      const form = new FormData();
      form.append(
        "file",
        new Blob([content], { type: "application/octet-stream" }),
      );

      const res = await fetch(`${base}/api/v0/add?pin=false&quiet=true`, {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        throw new Error(`IPFS add failed: ${res.status} ${await res.text()}`);
      }

      const json = await res.json();
      return json.Hash;
    },

    async cat(cid: string): Promise<string> {
      const res = await fetch(
        `${base}/api/v0/cat?arg=${encodeURIComponent(cid)}`,
        {
          method: "POST",
        },
      );

      if (!res.ok) {
        throw new Error(`IPFS cat failed: ${res.status} ${await res.text()}`);
      }

      return await res.text();
    },

    async pin(cid: string): Promise<void> {
      const res = await fetch(
        `${base}/api/v0/pin/add?arg=${encodeURIComponent(cid)}`,
        {
          method: "POST",
        },
      );

      if (!res.ok) {
        throw new Error(`IPFS pin failed: ${res.status} ${await res.text()}`);
      }
      // Consume body
      await res.text();
    },

    async unpin(cid: string): Promise<void> {
      const res = await fetch(
        `${base}/api/v0/pin/rm?arg=${encodeURIComponent(cid)}`,
        {
          method: "POST",
        },
      );

      if (!res.ok) {
        const body = await res.text();
        // "not pinned" is not an error for our purposes
        if (!body.includes("not pinned")) {
          throw new Error(`IPFS unpin failed: ${res.status} ${body}`);
        }
      } else {
        await res.text();
      }
    },

    async listPins(): Promise<string[]> {
      const res = await fetch(`${base}/api/v0/pin/ls?type=recursive`, {
        method: "POST",
      });

      if (!res.ok) {
        throw new Error(
          `IPFS pin ls failed: ${res.status} ${await res.text()}`,
        );
      }

      const json = await res.json();
      return Object.keys(json.Keys || {});
    },

    async isOnline(): Promise<boolean> {
      try {
        const res = await fetch(`${base}/api/v0/id`, { method: "POST" });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
