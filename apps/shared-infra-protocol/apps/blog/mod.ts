/**
 * @module
 * blog — sample app built on shared-infra.
 *
 * Exercises a different slice of the protocol than list-manager:
 *
 *   - content-addressed post bodies (`hash://sha256/...`)
 *   - mutable latest-pointer per post (`link://app/blog/latest/{slug}`)
 *   - a public "index" listing published slugs (`mutable://app/blog/index/...`)
 *   - per-user authored state under `/users/{pubkey}/...`
 *
 * Posts are *published* in a single envelope that writes the immutable body
 * AND updates the link. Authors can edit by re-publishing — the hash chain
 * is preserved automatically (old bodies remain readable at their hash URI).
 */

import { AppClient, type UserSession } from "../../sdk/mod.ts";

export const BLOG_APP_ID = "blog";

export interface BlogPost {
  slug: string;
  title: string;
  body: string;
  author: string;
  tags: string[];
  publishedAt: number;
  previousHash?: string;
}

export interface BlogIndexEntry {
  slug: string;
  title: string;
  author: string;
  latestHash: string;
  updatedAt: number;
}

export class Blog {
  constructor(readonly session: UserSession) {}

  static async connect(
    opts: { nodeUrl: string; identity: UserSession["identity"] } | {
      app: AppClient;
      identity: UserSession["identity"];
    },
  ): Promise<Blog> {
    const app = "app" in opts ? opts.app : new AppClient({
      nodeUrl: opts.nodeUrl,
      appId: BLOG_APP_ID,
    });
    await app.register({
      name: "Blog",
      description: "Content-addressed posts with mutable latest pointers",
    }).catch(() => {});
    return new Blog(app.withIdentity(opts.identity));
  }

  /**
   * Publish a post: stores body content-addressed, updates latest link,
   * bumps the public index entry, and writes an authoring record under
   * the user's signed namespace. Four writes, one envelope.
   */
  async publish(
    post: Omit<BlogPost, "publishedAt" | "author" | "previousHash">,
  ): Promise<{ slug: string; hashUri: string }> {
    const previousIndex = await this.readIndex(post.slug);
    const previousHash = previousIndex?.latestHash;

    const full: BlogPost = {
      ...post,
      author: this.session.pubkey,
      publishedAt: Date.now(),
      previousHash,
    };

    // Store body + update latest pointer atomically (one envelope).
    const { hashUri } = await this.session.app.publish(post.slug, full);

    // Index entry — lets apps list posts without walking all slugs.
    await this.session.app.putIndex(post.slug, {
      slug: post.slug,
      title: post.title,
      author: this.session.pubkey,
      latestHash: hashUri,
      updatedAt: full.publishedAt,
    } satisfies BlogIndexEntry);

    // Authoring record — proves authorship without requiring index trust.
    await this.session.saveDoc(`posts/${post.slug}`, {
      slug: post.slug,
      hashUri,
      publishedAt: full.publishedAt,
    });

    return { slug: post.slug, hashUri };
  }

  async getLatest(slug: string): Promise<BlogPost | undefined> {
    return await this.session.app.getLatest<BlogPost>(slug);
  }

  /** Return the full hash chain for a slug — the audit trail. */
  async history(slug: string): Promise<BlogPost[]> {
    const chain: BlogPost[] = [];
    let cursor = await this.getLatest(slug);
    while (cursor) {
      chain.push(cursor);
      if (!cursor.previousHash) break;
      cursor = await this.session.app.getContent<BlogPost>(cursor.previousHash);
    }
    return chain;
  }

  async listPosts(): Promise<BlogIndexEntry[]> {
    const rows = await this.session.app.listIndex();
    return rows
      .map((r) => r.data as BlogIndexEntry)
      .filter((e) => e && typeof e === "object" && "slug" in e);
  }

  private async readIndex(slug: string): Promise<BlogIndexEntry | undefined> {
    const rows = await this.session.app.listIndex(slug);
    for (const r of rows) {
      const entry = r.data as BlogIndexEntry;
      if (entry && typeof entry === "object" && entry.slug === slug) {
        return entry;
      }
    }
    // Fallback: direct read in case listIndex walks a different prefix
    const key = `mutable://app/${this.session.app.appId}/index/${slug}`;
    const [res] = await this.session.app.client.read<BlogIndexEntry>(key);
    return res.record?.data;
  }
}
