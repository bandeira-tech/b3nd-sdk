/**
 * @module
 * inkwell — a blog sample app on the sharenet protocol.
 *
 * Posts are the classic b3nd "content + link" pattern:
 *
 *   - The post body is published as an immutable `hash://sha256/...` blob.
 *   - A signed `link://sharenet/inkwell/{author}/posts/{slug}` pins the
 *     current version.
 *   - An index list is written to the app-wide shared feed so other
 *     users can discover posts without knowing each author's pubkey up
 *     front.
 *
 * This exercises the big-payload `hash://` path, cross-program reads
 * (`link://` → `hash://`), and shared-feed listing.
 */

import { Identity, Rig } from "@b3nd/rig";
import { SharenetSession } from "@sharenet/protocol";

export interface Post {
  slug: string;
  title: string;
  body: string;
  tags?: string[];
  publishedAt: string;
}

export interface PostIndexEntry {
  slug: string;
  title: string;
  author: string;
  hash: string;
  publishedAt: string;
}

export class Inkwell {
  private readonly s: SharenetSession;

  constructor(rig: Rig, identity: Identity) {
    this.s = new SharenetSession(rig, "inkwell", identity);
  }

  /** Publish a new version of a post and announce it on the shared feed. */
  async publish(
    input: Omit<Post, "publishedAt"> & { publishedAt?: string },
  ): Promise<PostIndexEntry> {
    const post: Post = {
      publishedAt: new Date().toISOString(),
      ...input,
    };
    const hashUri = await this.s.publishBlob(post);
    await this.s.setLink(`posts/${post.slug}`, hashUri);

    const entry: PostIndexEntry = {
      slug: post.slug,
      title: post.title,
      author: this.s.pubkey,
      hash: hashUri,
      publishedAt: post.publishedAt,
    };
    // The shared feed path includes the slug so republishes overwrite the
    // entry in place instead of duplicating it.
    await this.s.setShared(`feed/${post.slug}`, entry);
    return entry;
  }

  /** Resolve the current version of a post by slug, for this author. */
  async readOwn(slug: string): Promise<Post | null> {
    return this.s.resolveLink<Post>(`posts/${slug}`);
  }

  /** Walk the app-wide feed of most-recently-published posts. */
  async feed(): Promise<PostIndexEntry[]> {
    const items = await this.s.listShared<PostIndexEntry>();
    return items
      .map((i) => i.data)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  }

  /** Resolve any post in the feed to its full content. */
  async readPost(entry: PostIndexEntry): Promise<Post | null> {
    const [content] = await this.s.session.rig.read<Post>(entry.hash);
    return content?.record?.data ?? null;
  }
}
