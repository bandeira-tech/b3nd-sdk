/**
 * build-learn-books.ts
 *
 * Reads markdown files from skills/b3nd/ and docs/proposals/, builds a
 * LearnCatalog, writes it as static JSON, and optionally uploads to a
 * B3nd node.
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

interface LearnBook {
  key: string;
  title: string;
  label: string;
  description: string;
  tier: string;
  markdown: string;
  sections: Section[];
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
  tier: "documentation" | "cookbook" | "design" | "proposals";
}

const SKILLS_DIR = "skills/b3nd";
const PROPOSALS_DIR = "docs/proposals";

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
// File reading
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

async function collectBooks(): Promise<LearnBook[]> {
  const books: LearnBook[] = [];

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
  const tierOrder: Record<string, number> = { documentation: 0, cookbook: 1, design: 2, proposals: 3 };
  books.sort((a, b) => {
    const ta = tierOrder[a.tier] ?? 99;
    const tb = tierOrder[b.tier] ?? 99;
    if (ta !== tb) return ta - tb;
    return a.key.localeCompare(b.key);
  });

  return books;
}

// ---------------------------------------------------------------------------
// B3nd upload
// ---------------------------------------------------------------------------

async function uploadToB3nd(nodeUrl: string, catalog: LearnCatalog): Promise<boolean> {
  console.log(`\nUploading catalog to B3nd at ${nodeUrl}...`);

  try {
    // Upload full catalog
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

    // Upload individual books
    for (const book of catalog.books) {
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

    return true;
  } catch (e) {
    console.warn(`  B3nd upload failed: ${e}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Static file output
// ---------------------------------------------------------------------------

async function writeStaticFile(outputPath: string, catalog: LearnCatalog): Promise<void> {
  // Ensure parent directory exists
  const dir = outputPath.substring(0, outputPath.lastIndexOf("/"));
  try {
    await Deno.mkdir(dir, { recursive: true });
  } catch {
    // directory may already exist
  }

  const json = JSON.stringify(catalog, null, 2);
  await Deno.writeTextFile(outputPath, json);
  console.log(`\nStatic catalog written to ${outputPath} (${(json.length / 1024).toFixed(1)} KB)`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== B3nd Learn Book Builder ===\n");

  const books = await collectBooks();
  console.log(`\nCollected ${books.length} books:`);
  for (const b of books) {
    console.log(`  [${b.tier}] ${b.key} — "${b.label}" (${b.sections.length} sections)`);
  }

  const catalog: LearnCatalog = {
    books,
    generatedAt: Date.now(),
  };

  // Always write static file
  const staticPath = Deno.env.get("LEARN_OUTPUT_STATIC") ?? "apps/b3nd-web-rig/public/learn/catalog.json";
  await writeStaticFile(staticPath, catalog);

  // Optionally upload to B3nd
  const nodeUrl = Deno.env.get("B3ND_NODE_URL") ?? "http://localhost:9942";
  await uploadToB3nd(nodeUrl, catalog);

  console.log("\nDone.");
}

main();
