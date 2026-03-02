/**
 * build-learn-books.ts
 *
 * Reads markdown files from skills/b3nd/, docs/proposals/, and docs/book/,
 * builds a LearnCatalog, writes it as static JSON, and optionally uploads
 * to a B3nd node.
 *
 * Multi-chapter books (docs/book/) are split into individual chapter files:
 *   - The catalog index contains only chapter metadata (title, sections, URI)
 *   - Each chapter's markdown is written to its own static file and B3nd URI
 *   - The web app loads chapter content on demand
 *
 * Usage:
 *   deno run -A apps/b3nd-web-rig/scripts/build-learn-books.ts
 *
 * Environment variables:
 *   B3ND_NODE_URL          — B3nd HTTP API base (default: http://localhost:9942)
 *   LEARN_OUTPUT_STATIC    — Static JSON output path (default: apps/b3nd-web-rig/public/learn/catalog.json)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Section {
  id: string;
  title: string;
  level: number;
  children: Section[];
}

interface ChapterMeta {
  key: string;
  number: number;
  title: string;
  part: string;
  sections: Section[];
  uri: string;
}

interface ChapterContent {
  key: string;
  title: string;
  markdown: string;
  sections: Section[];
}

interface LearnBook {
  key: string;
  title: string;
  label: string;
  description: string;
  tier: string;
  markdown?: string;
  sections: Section[];
  chapters?: ChapterMeta[];
  updatedAt: number;
}

interface LearnCatalog {
  books: LearnBook[];
  generatedAt: number;
}

// ---------------------------------------------------------------------------
// Tier & metadata mapping
// ---------------------------------------------------------------------------

interface BookMeta {
  key: string;
  label: string;
  description: string;
  tier: "guide" | "documentation" | "cookbook" | "design" | "proposals";
}

const SKILLS_DIR = "skills/b3nd";
const PROPOSALS_DIR = "docs/proposals";
const BOOK_DIR = "docs/book";

const BOOK_META: Record<string, BookMeta> = {
  "SKILL.md": { key: "b3nd", label: "B3nd Overview", description: "What B3nd is and how it works", tier: "documentation" },
  "FIRECAT.md": { key: "firecat", label: "Firecat Reference", description: "Schema, URIs, auth, visibility", tier: "documentation" },
  "FRAMEWORK.md": { key: "framework", label: "Framework Reference", description: "Protocol design, dispatch, primitives", tier: "documentation" },
  "OPERATORS.md": { key: "operators", label: "Operators Guide", description: "Architecture, backends, managed mode", tier: "documentation" },
  "FAQ.md": { key: "faq", label: "Design Decisions", description: "Why things work the way they do", tier: "documentation" },
  "APP_COOKBOOK.md": { key: "app-cookbook", label: "Building Firecat Apps", description: "Quick start, CRUD, browser apps, testing", tier: "cookbook" },
  "PROTOCOL_COOKBOOK.md": { key: "protocol-cookbook", label: "Designing Protocols", description: "Worked examples, packaging SDKs", tier: "cookbook" },
  "NODE_COOKBOOK.md": { key: "node-cookbook", label: "Running Nodes", description: "Deployment, Docker, monitoring", tier: "cookbook" },
  "DESIGN_EXCHANGE.md": { key: "design-exchange", label: "Exchange Patterns", description: "Trust models, party interactions, crypto guarantees", tier: "design" },
  "DESIGN_INFRASTRUCTURE.md": { key: "design-infrastructure", label: "Infrastructure", description: "Node requirements, deployment topologies, scaling", tier: "design" },
  "DESIGN_TRANSPORT.md": { key: "design-transport", label: "Transport", description: "WebSocket, WebRTC, SSE, and the subscribe primitive", tier: "design" },
  // Proposals
  "tokenization-gas-semantics.md": { key: "tokenization-gas-semantics", label: "Tokenization & Gas Semantics", description: "Economic layer proposals for B3nd message passing", tier: "proposals" },
  "firecat-economic-model.md": { key: "firecat-economic-model", label: "Firecat Economic Model", description: "Full economic vision: subsidies, ads, node operators, DePIN template", tier: "proposals" },
};

// Part assignments for book chapters (derived from the book structure)
const CHAPTER_PARTS: Record<string, string> = {
  "01": "The Conversation",
  "02": "The Conversation",
  "03": "The Conversation",
  "04": "The Conversation",
  "05": "The Conversation",
  "06": "The Message",
  "07": "The Message",
  "08": "The Message",
  "09": "The Message",
  "10": "The Network",
  "11": "The Network",
  "12": "The Network",
  "13": "The Network",
  "14": "The Network",
  "15": "The Network",
  "16": "The Network",
};

// ---------------------------------------------------------------------------
// Section parser (mirrors parseSkillSections.ts from the web rig)
// ---------------------------------------------------------------------------

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseSections(markdown: string): Section[] {
  const stripped = markdown.replace(/^---[\s\S]*?---\n*/, "");
  const lines = stripped.split("\n");
  const sections: Section[] = [];
  let currentH2: Section | null = null;

  for (const line of lines) {
    const h2Match = line.match(/^## (.+)$/);
    const h3Match = line.match(/^### (.+)$/);

    if (h2Match) {
      const title = h2Match[1];
      currentH2 = { id: slugify(title), title, level: 2, children: [] };
      sections.push(currentH2);
    } else if (h3Match && currentH2) {
      const title = h3Match[1];
      currentH2.children.push({ id: slugify(title), title, level: 3, children: [] });
    }
  }

  return sections;
}

function extractTitle(markdown: string, filename: string): string {
  const h1Match = markdown.match(/^# (.+)$/m);
  if (h1Match) return h1Match[1];
  return filename.replace(/\.md$/, "").replace(/[-_]/g, " ");
}

// ---------------------------------------------------------------------------
// Single-file book reading (existing behavior)
// ---------------------------------------------------------------------------

async function readBook(filePath: string, filename: string): Promise<LearnBook | null> {
  const meta = BOOK_META[filename];
  if (!meta) {
    console.warn(`  Skipping unknown file: ${filename}`);
    return null;
  }

  const markdown = await Deno.readTextFile(filePath);
  const stat = await Deno.stat(filePath);
  const title = extractTitle(markdown, filename);
  const sections = parseSections(markdown);

  return {
    key: meta.key,
    title,
    label: meta.label,
    description: meta.description,
    tier: meta.tier,
    markdown,
    sections,
    updatedAt: stat.mtime?.getTime() ?? Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Multi-chapter book reading (docs/book/)
// ---------------------------------------------------------------------------

interface CollectedChapter {
  meta: ChapterMeta;
  content: ChapterContent;
}

async function readChapterBook(): Promise<{ book: LearnBook; chapters: CollectedChapter[] } | null> {
  const bookKey = "message-guide";
  const uriBase = `mutable://open/rig/learn/chapters/${bookKey}`;

  // Read README.md for the book-level description
  let readmeMarkdown = "";
  try {
    readmeMarkdown = await Deno.readTextFile(`${BOOK_DIR}/README.md`);
  } catch {
    console.warn(`  No README.md found in ${BOOK_DIR}`);
  }

  const bookTitle = extractTitle(readmeMarkdown, "README.md") || "What's in a Message";

  // Collect numbered chapter files
  const chapterFiles: string[] = [];
  try {
    for await (const entry of Deno.readDir(BOOK_DIR)) {
      if (!entry.isFile || !entry.name.endsWith(".md") || entry.name === "README.md") continue;
      chapterFiles.push(entry.name);
    }
  } catch (e) {
    console.warn(`  Could not read ${BOOK_DIR}: ${e}`);
    return null;
  }

  if (chapterFiles.length === 0) return null;

  // Sort by filename (01-..., 02-..., etc.)
  chapterFiles.sort();

  const chapters: CollectedChapter[] = [];
  let latestMtime = 0;

  for (const filename of chapterFiles) {
    const filePath = `${BOOK_DIR}/${filename}`;
    const markdown = await Deno.readTextFile(filePath);
    const stat = await Deno.stat(filePath);
    if (stat.mtime && stat.mtime.getTime() > latestMtime) {
      latestMtime = stat.mtime.getTime();
    }

    // Extract chapter number from filename (e.g., "01-two-friends.md" → 1)
    const numMatch = filename.match(/^(\d+)/);
    const chapterNum = numMatch ? parseInt(numMatch[1], 10) : 0;
    const chapterKey = filename.replace(/\.md$/, "");

    const title = extractTitle(markdown, filename);
    const sections = parseSections(markdown);
    const partPrefix = numMatch ? numMatch[1] : "00";
    const part = CHAPTER_PARTS[partPrefix] ?? "Appendix";

    const uri = `${uriBase}/${chapterKey}`;

    chapters.push({
      meta: {
        key: chapterKey,
        number: chapterNum,
        title,
        part,
        sections,
        uri,
      },
      content: {
        key: chapterKey,
        title,
        markdown,
        sections,
      },
    });
  }

  // Build the book entry with chapter index only (no inline markdown)
  const book: LearnBook = {
    key: bookKey,
    title: bookTitle,
    label: "What's in a Message",
    description: "A design guide teaching b3nd through dialogue, letters, and digital messages",
    tier: "guide",
    sections: [],
    chapters: chapters.map((c) => c.meta),
    updatedAt: latestMtime || Date.now(),
  };

  return { book, chapters };
}

// ---------------------------------------------------------------------------
// Collect all books
// ---------------------------------------------------------------------------

async function collectBooks(): Promise<{ books: LearnBook[]; chapterContents: CollectedChapter[] }> {
  const books: LearnBook[] = [];
  let chapterContents: CollectedChapter[] = [];

  // Read multi-chapter book from docs/book/
  console.log(`Reading ${BOOK_DIR}/...`);
  const chapterBook = await readChapterBook();
  if (chapterBook) {
    books.push(chapterBook.book);
    chapterContents = chapterBook.chapters;
    console.log(`  Found chapter book: "${chapterBook.book.label}" (${chapterContents.length} chapters)`);
  }

  // Read skills/b3nd/
  console.log(`Reading ${SKILLS_DIR}/...`);
  for await (const entry of Deno.readDir(SKILLS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".md")) continue;
    const book = await readBook(`${SKILLS_DIR}/${entry.name}`, entry.name);
    if (book) books.push(book);
  }

  // Read docs/proposals/
  console.log(`Reading ${PROPOSALS_DIR}/...`);
  try {
    for await (const entry of Deno.readDir(PROPOSALS_DIR)) {
      if (!entry.isFile || !entry.name.endsWith(".md")) continue;
      const book = await readBook(`${PROPOSALS_DIR}/${entry.name}`, entry.name);
      if (book) books.push(book);
    }
  } catch (e) {
    console.warn(`  Could not read ${PROPOSALS_DIR}: ${e}`);
  }

  // Sort by tier order then key
  const tierOrder: Record<string, number> = { guide: 0, documentation: 1, cookbook: 2, design: 3, proposals: 4 };
  books.sort((a, b) => {
    const ta = tierOrder[a.tier] ?? 99;
    const tb = tierOrder[b.tier] ?? 99;
    if (ta !== tb) return ta - tb;
    return a.key.localeCompare(b.key);
  });

  return { books, chapterContents };
}

// ---------------------------------------------------------------------------
// B3nd upload
// ---------------------------------------------------------------------------

async function uploadToB3nd(
  nodeUrl: string,
  catalog: LearnCatalog,
  chapterContents: CollectedChapter[],
): Promise<boolean> {
  console.log(`\nUploading catalog to B3nd at ${nodeUrl}...`);

  try {
    // Upload catalog index (lightweight — no chapter markdown)
    const catalogRes = await fetch(`${nodeUrl}/api/v1/receive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tx: ["mutable://open/rig/learn/catalog", catalog] }),
    });

    if (!catalogRes.ok) {
      console.warn(`  Catalog upload failed: ${catalogRes.status} ${catalogRes.statusText}`);
      return false;
    }
    console.log("  Catalog uploaded.");

    // Upload individual single-file books
    for (const book of catalog.books) {
      if (book.chapters) continue; // chapter-based books are uploaded per-chapter
      const bookRes = await fetch(`${nodeUrl}/api/v1/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tx: [`mutable://open/rig/learn/books/${book.key}`, book] }),
      });

      if (bookRes.ok) {
        console.log(`  Book "${book.key}" uploaded.`);
      } else {
        console.warn(`  Book "${book.key}" upload failed: ${bookRes.status}`);
      }
    }

    // Upload individual chapters to their own URIs
    for (const chapter of chapterContents) {
      const chapterRes = await fetch(`${nodeUrl}/api/v1/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tx: [chapter.meta.uri, chapter.content] }),
      });

      if (chapterRes.ok) {
        console.log(`  Chapter "${chapter.meta.key}" uploaded to ${chapter.meta.uri}`);
      } else {
        console.warn(`  Chapter "${chapter.meta.key}" upload failed: ${chapterRes.status}`);
      }
    }

    return true;
  } catch (e) {
    console.warn(`  B3nd upload failed: ${e}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Static file output
// ---------------------------------------------------------------------------

async function ensureDir(dir: string): Promise<void> {
  try {
    await Deno.mkdir(dir, { recursive: true });
  } catch {
    // already exists
  }
}

async function writeStaticFiles(
  outputPath: string,
  catalog: LearnCatalog,
  chapterContents: CollectedChapter[],
): Promise<void> {
  const dir = outputPath.substring(0, outputPath.lastIndexOf("/"));
  await ensureDir(dir);

  // Write catalog index (lightweight)
  const json = JSON.stringify(catalog, null, 2);
  await Deno.writeTextFile(outputPath, json);
  console.log(`\nStatic catalog written to ${outputPath} (${(json.length / 1024).toFixed(1)} KB)`);

  // Write individual chapter files as static JSON
  if (chapterContents.length > 0) {
    const chaptersDir = `${dir}/chapters`;
    await ensureDir(chaptersDir);

    for (const chapter of chapterContents) {
      const chapterPath = `${chaptersDir}/${chapter.meta.key}.json`;
      const chapterJson = JSON.stringify(chapter.content, null, 2);
      await Deno.writeTextFile(chapterPath, chapterJson);
    }

    console.log(`  ${chapterContents.length} chapter files written to ${chaptersDir}/`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== B3nd Learn Book Builder ===\n");

  const { books, chapterContents } = await collectBooks();
  console.log(`\nCollected ${books.length} books:`);
  for (const b of books) {
    const extra = b.chapters ? ` (${b.chapters.length} chapters)` : ` (${b.sections.length} sections)`;
    console.log(`  [${b.tier}] ${b.key} — "${b.label}"${extra}`);
  }

  const catalog: LearnCatalog = {
    books,
    generatedAt: Date.now(),
  };

  // Always write static files
  const staticPath = Deno.env.get("LEARN_OUTPUT_STATIC") ?? "apps/b3nd-web-rig/public/learn/catalog.json";
  await writeStaticFiles(staticPath, catalog, chapterContents);

  // Optionally upload to B3nd
  const nodeUrl = Deno.env.get("B3ND_NODE_URL") ?? "http://localhost:9942";
  await uploadToB3nd(nodeUrl, catalog, chapterContents);

  console.log("\nDone.");
}

main();
