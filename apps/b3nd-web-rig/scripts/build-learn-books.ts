/**
 * build-learn-books.ts
 *
 * Reads markdown sources, builds a LearnCatalog of books where every book
 * is a list of chapters. Single-file books become one-chapter books.
 * Multi-file books (docs/book/) become many-chapter books. Same shape.
 *
 * Each chapter's content is stored at its own URI / static file.
 * The catalog index contains only metadata — no markdown.
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

interface CollectedChapter {
  meta: ChapterMeta;
  content: ChapterContent;
}

interface LearnBook {
  key: string;
  title: string;
  label: string;
  description: string;
  tier: string;
  chapters: ChapterMeta[];
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

// Part assignments for multi-chapter book chapters
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
// Section parser
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
// Single-file book reading — produces a one-chapter book
// ---------------------------------------------------------------------------

async function readSingleFileBook(filePath: string, filename: string): Promise<{ book: LearnBook; chapter: CollectedChapter } | null> {
  const meta = BOOK_META[filename];
  if (!meta) {
    console.warn(`  Skipping unknown file: ${filename}`);
    return null;
  }

  const markdown = await Deno.readTextFile(filePath);
  const stat = await Deno.stat(filePath);
  const title = extractTitle(markdown, filename);
  const sections = parseSections(markdown);
  const uri = `mutable://open/rig/learn/chapters/${meta.key}/${meta.key}`;

  const chapterMeta: ChapterMeta = {
    key: meta.key,
    number: 1,
    title,
    part: "",
    sections,
    uri,
  };

  const book: LearnBook = {
    key: meta.key,
    title,
    label: meta.label,
    description: meta.description,
    tier: meta.tier,
    chapters: [chapterMeta],
    updatedAt: stat.mtime?.getTime() ?? Date.now(),
  };

  const chapter: CollectedChapter = {
    meta: chapterMeta,
    content: { key: meta.key, title, markdown, sections },
  };

  return { book, chapter };
}

// ---------------------------------------------------------------------------
// Multi-chapter book reading (docs/book/)
// ---------------------------------------------------------------------------

async function readMultiChapterBook(): Promise<{ book: LearnBook; chapters: CollectedChapter[] } | null> {
  const bookKey = "message-guide";
  const uriBase = `mutable://open/rig/learn/chapters/${bookKey}`;

  let readmeMarkdown = "";
  try {
    readmeMarkdown = await Deno.readTextFile(`${BOOK_DIR}/README.md`);
  } catch {
    console.warn(`  No README.md found in ${BOOK_DIR}`);
  }

  const bookTitle = extractTitle(readmeMarkdown, "README.md") || "What's in a Message";

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

    const numMatch = filename.match(/^(\d+)/);
    const chapterNum = numMatch ? parseInt(numMatch[1], 10) : 0;
    const chapterKey = filename.replace(/\.md$/, "");
    const title = extractTitle(markdown, filename);
    const sections = parseSections(markdown);
    const partPrefix = numMatch ? numMatch[1] : "00";
    const part = CHAPTER_PARTS[partPrefix] ?? "Appendix";
    const uri = `${uriBase}/${chapterKey}`;

    chapters.push({
      meta: { key: chapterKey, number: chapterNum, title, part, sections, uri },
      content: { key: chapterKey, title, markdown, sections },
    });
  }

  const book: LearnBook = {
    key: bookKey,
    title: bookTitle,
    label: "What's in a Message",
    description: "A design guide teaching b3nd through dialogue, letters, and digital messages",
    tier: "guide",
    chapters: chapters.map((c) => c.meta),
    updatedAt: latestMtime || Date.now(),
  };

  return { book, chapters };
}

// ---------------------------------------------------------------------------
// Collect all books
// ---------------------------------------------------------------------------

async function collectBooks(): Promise<{ books: LearnBook[]; allChapters: CollectedChapter[] }> {
  const books: LearnBook[] = [];
  const allChapters: CollectedChapter[] = [];

  // Multi-chapter book from docs/book/
  console.log(`Reading ${BOOK_DIR}/...`);
  const multiBook = await readMultiChapterBook();
  if (multiBook) {
    books.push(multiBook.book);
    allChapters.push(...multiBook.chapters);
    console.log(`  "${multiBook.book.label}" (${multiBook.chapters.length} chapters)`);
  }

  // Single-file books from skills/b3nd/
  console.log(`Reading ${SKILLS_DIR}/...`);
  for await (const entry of Deno.readDir(SKILLS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".md")) continue;
    const result = await readSingleFileBook(`${SKILLS_DIR}/${entry.name}`, entry.name);
    if (result) {
      books.push(result.book);
      allChapters.push(result.chapter);
    }
  }

  // Single-file books from docs/proposals/
  console.log(`Reading ${PROPOSALS_DIR}/...`);
  try {
    for await (const entry of Deno.readDir(PROPOSALS_DIR)) {
      if (!entry.isFile || !entry.name.endsWith(".md")) continue;
      const result = await readSingleFileBook(`${PROPOSALS_DIR}/${entry.name}`, entry.name);
      if (result) {
        books.push(result.book);
        allChapters.push(result.chapter);
      }
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

  return { books, allChapters };
}

// ---------------------------------------------------------------------------
// B3nd upload
// ---------------------------------------------------------------------------

async function uploadToB3nd(nodeUrl: string, catalog: LearnCatalog, chapters: CollectedChapter[]): Promise<boolean> {
  console.log(`\nUploading to B3nd at ${nodeUrl}...`);

  try {
    // Catalog index
    const catalogRes = await fetch(`${nodeUrl}/api/v1/receive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tx: ["mutable://open/rig/learn/catalog", catalog] }),
    });
    if (!catalogRes.ok) {
      console.warn(`  Catalog upload failed: ${catalogRes.status}`);
      return false;
    }
    console.log("  Catalog uploaded.");

    // All chapters (both single-file and multi-chapter)
    for (const chapter of chapters) {
      const res = await fetch(`${nodeUrl}/api/v1/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tx: [chapter.meta.uri, chapter.content] }),
      });
      if (res.ok) {
        console.log(`  Chapter "${chapter.meta.key}" → ${chapter.meta.uri}`);
      } else {
        console.warn(`  Chapter "${chapter.meta.key}" upload failed: ${res.status}`);
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
  try { await Deno.mkdir(dir, { recursive: true }); } catch { /* exists */ }
}

async function writeStaticFiles(outputPath: string, catalog: LearnCatalog, chapters: CollectedChapter[]): Promise<void> {
  const dir = outputPath.substring(0, outputPath.lastIndexOf("/"));
  await ensureDir(dir);

  const json = JSON.stringify(catalog, null, 2);
  await Deno.writeTextFile(outputPath, json);
  console.log(`\nStatic catalog written to ${outputPath} (${(json.length / 1024).toFixed(1)} KB)`);

  // All chapter content as individual static files
  const chaptersDir = `${dir}/chapters`;
  await ensureDir(chaptersDir);
  for (const chapter of chapters) {
    const chapterPath = `${chaptersDir}/${chapter.meta.key}.json`;
    await Deno.writeTextFile(chapterPath, JSON.stringify(chapter.content, null, 2));
  }
  console.log(`  ${chapters.length} chapter files written to ${chaptersDir}/`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== B3nd Learn Book Builder ===\n");

  const { books, allChapters } = await collectBooks();
  console.log(`\nCollected ${books.length} books, ${allChapters.length} total chapters:`);
  for (const b of books) {
    console.log(`  [${b.tier}] ${b.key} — "${b.label}" (${b.chapters.length} ch)`);
  }

  const catalog: LearnCatalog = { books, generatedAt: Date.now() };

  const staticPath = Deno.env.get("LEARN_OUTPUT_STATIC") ?? "apps/b3nd-web-rig/public/learn/catalog.json";
  await writeStaticFiles(staticPath, catalog, allChapters);

  const nodeUrl = Deno.env.get("B3ND_NODE_URL") ?? "http://localhost:9942";
  await uploadToB3nd(nodeUrl, catalog, allChapters);

  console.log("\nDone.");
}

main();
