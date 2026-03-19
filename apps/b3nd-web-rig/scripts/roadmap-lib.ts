/**
 * roadmap-lib.ts
 *
 * Shared roadmap logic: types, parsing, wave computation, catalog building.
 * Imported by build-roadmap.ts (batch) and roadmap-manager.ts (live service).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PRComment {
  author: string;
  body: string;
  createdAt: string;
}

export interface RoadmapStory {
  id: string;
  title: string;
  group: string;
  category: string;
  section: string;
  dependsOn: string[];
  blocks: string[];
  priority: "critical" | "high" | "medium" | "low";
  scope: string;
  estimatedPrs: number;
  filesInvolved: string[];
  tags: string[];
  status: "pending" | "in-progress" | "review" | "merged";
  pr?: { number: number; url: string; state: string; title: string };
  uri: string;
  markdown: string;
  wave: number;
  keywords: string[];
  prComments?: PRComment[];
  tasksExcerpt?: string;
}

export interface RoadmapGroup {
  id: string;
  name: string;
  stories: string[];
  progress: { total: number; done: number; inProgress: number; review: number };
  criticalPath: string[];
  nextUnblocked: string[];
}

export interface SharedConcern {
  tag: string;
  storyIds: string[];
  groups: string[];
}

export interface WaveStats {
  wave: number;
  total: number;
  done: number;
}

export interface RoadmapCatalog {
  groups: RoadmapGroup[];
  stories: Omit<RoadmapStory, "markdown">[];
  generatedAt: number;
  stats: {
    total: number;
    byPriority: Record<string, number>;
    byScope: Record<string, number>;
    byStatus: Record<string, number>;
  };
  waves: WaveStats[];
  sharedConcerns: SharedConcern[];
  landscapeSections: Record<string, string>;
}

export interface GitHubPR {
  number: number;
  title: string;
  headRefName: string;
  state: string;
  url: string;
}

export interface GitHubPRDetail {
  number: number;
  reviews: { author: { login: string }; body: string; createdAt: string }[];
  comments: { author: { login: string }; body: string; createdAt: string }[];
}

// ---------------------------------------------------------------------------
// Group display names + section-to-group mapping
// ---------------------------------------------------------------------------

export const GROUP_NAMES: Record<string, string> = {
  "apps-possible": "Make Apps Possible",
  "nodes-talk": "Nodes Talk",
  "make-it-pay": "Make It Pay",
  "platform-features": "Platform Features",
  "tell-the-story": "Tell the Story",
};

export const SECTION_TO_GROUP: Record<string, string> = {
  A4: "apps-possible",
  A5: "apps-possible",
  A6: "apps-possible",
  A7: "apps-possible",
  A8: "apps-possible",
  D1: "apps-possible",
  D2: "apps-possible",
  A1: "nodes-talk",
  A2: "nodes-talk",
  A3: "nodes-talk",
  E1: "nodes-talk",
  B1: "make-it-pay",
  B2: "make-it-pay",
  B3: "make-it-pay",
  B4: "make-it-pay",
  B5: "make-it-pay",
  C1: "make-it-pay",
  C2: "make-it-pay",
  C3: "make-it-pay",
  C4: "make-it-pay",
  G1: "make-it-pay",
  G2: "make-it-pay",
  F1: "tell-the-story",
  F2: "tell-the-story",
  F3: "tell-the-story",
  G3: "tell-the-story",
  D3: "platform-features",
  A9: "platform-features",
  E2: "platform-features",
};

export const SHARED_CONCERN_TAGS: Record<string, RegExp> = {
  "validator-pattern": /G2-A2-0[1-7]|G3-B1-0[1-4]|G3-C3-01/,
  "compose-system": /G1-A6-03|G2-A1-|G2-A2-03|G3-B2-03/,
  "websocket": /G1-A5-0[1-3]|G2-A1-04/,
  "utxo": /G3-B1-0[1-4]|G3-B2-0[1-5]|G3-B3-/,
  "rate-limiting": /G5-A9-02|G5-E2-03/,
  "key-management": /G1-A7-0[2-5]|G5-A9-03|G5-A9-04/,
  "docs-overlap": /G1-A7-01|G1-A8-01|G1-D1-|G4-D1-/,
};

// ---------------------------------------------------------------------------
// YAML frontmatter parser (simple regex, no deps)
// ---------------------------------------------------------------------------

export function parseFrontmatter(content: string): { meta: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const yamlBlock = match[1];
  const body = match[2];
  const meta: Record<string, unknown> = {};

  let currentKey = "";
  let currentArray: string[] | null = null;

  for (const line of yamlBlock.split("\n")) {
    // Array item
    if (currentArray !== null && line.match(/^\s+-\s+/)) {
      const val = line.replace(/^\s+-\s+/, "").replace(/^"(.*)"$/, "$1").trim();
      if (val) currentArray.push(val);
      continue;
    }

    // Flush any pending array
    if (currentArray !== null) {
      meta[currentKey] = currentArray;
      currentArray = null;
    }

    // Key-value pair
    const kvMatch = line.match(/^(\w[\w_]*)\s*:\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const rawValue = kvMatch[2].trim();

      if (rawValue === "" || rawValue === "[]") {
        if (rawValue === "[]") {
          meta[currentKey] = [];
        } else {
          currentArray = [];
        }
      } else {
        meta[currentKey] = rawValue.replace(/^"(.*)"$/, "$1");
      }
    }
  }

  // Flush final array
  if (currentArray !== null) {
    meta[currentKey] = currentArray;
  }

  return { meta, body };
}

export function asStringArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.map(String);
  return [];
}

export function asString(val: unknown, fallback = ""): string {
  if (typeof val === "string") return val;
  return fallback;
}

export function asNumber(val: unknown, fallback = 0): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = parseInt(val, 10);
    return isNaN(n) ? fallback : n;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Keyword extraction from markdown headings
// ---------------------------------------------------------------------------

export function extractKeywords(markdown: string): string[] {
  const keywords: string[] = [];
  const headingRegex = /^#{2,3}\s+(.+)$/gm;
  let m;
  while ((m = headingRegex.exec(markdown)) !== null) {
    const text = m[1].trim();
    const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (slug && slug.length > 1) keywords.push(slug);
  }
  return keywords;
}

// ---------------------------------------------------------------------------
// Wave computation (topological sort)
// ---------------------------------------------------------------------------

export function computeWaves(stories: RoadmapStory[]): void {
  const waves = new Map<string, number>();
  let changed = true;
  let iterations = 0;
  const maxIterations = stories.length + 1;

  for (const s of stories) {
    waves.set(s.id, 0);
  }

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;
    for (const s of stories) {
      let maxDepWave = -1;
      for (const depId of s.dependsOn) {
        const depWave = waves.get(depId);
        if (depWave !== undefined && depWave > maxDepWave) {
          maxDepWave = depWave;
        }
      }
      const newWave = maxDepWave >= 0 ? maxDepWave + 1 : 0;
      if (newWave !== waves.get(s.id)) {
        waves.set(s.id, newWave);
        changed = true;
      }
    }
  }

  for (const s of stories) {
    s.wave = waves.get(s.id) ?? 0;
  }
}

// ---------------------------------------------------------------------------
// Critical path computation per group
// ---------------------------------------------------------------------------

export function computeCriticalPath(storyIds: string[], storyMap: Map<string, RoadmapStory>): string[] {
  const unfinished = storyIds.filter((id) => {
    const s = storyMap.get(id);
    return s && s.status !== "merged";
  });

  if (unfinished.length === 0) return [];

  const memo = new Map<string, string[]>();

  function longestChain(id: string): string[] {
    if (memo.has(id)) return memo.get(id)!;
    const s = storyMap.get(id);
    if (!s || s.status === "merged") {
      memo.set(id, []);
      return [];
    }
    let best: string[] = [];
    for (const depId of s.dependsOn) {
      const chain = longestChain(depId);
      if (chain.length > best.length) best = chain;
    }
    const result = [...best, id];
    memo.set(id, result);
    return result;
  }

  let longest: string[] = [];
  for (const id of unfinished) {
    const chain = longestChain(id);
    if (chain.length > longest.length) longest = chain;
  }
  return longest;
}

export function computeNextUnblocked(storyIds: string[], storyMap: Map<string, RoadmapStory>): string[] {
  return storyIds.filter((id) => {
    const s = storyMap.get(id);
    if (!s || s.status === "merged" || s.status === "in-progress") return false;
    return s.dependsOn.every((depId) => {
      const dep = storyMap.get(depId);
      return !dep || dep.status === "merged";
    });
  });
}

// ---------------------------------------------------------------------------
// Shared concerns
// ---------------------------------------------------------------------------

export function computeSharedConcerns(stories: RoadmapStory[]): SharedConcern[] {
  const concerns: SharedConcern[] = [];
  for (const [tag, pattern] of Object.entries(SHARED_CONCERN_TAGS)) {
    const matchingIds = stories.filter((s) => pattern.test(s.id)).map((s) => s.id);
    if (matchingIds.length === 0) continue;
    const groups = [...new Set(matchingIds.map((id) => {
      const s = stories.find((st) => st.id === id);
      return s?.group ?? "unknown";
    }))];
    concerns.push({ tag, storyIds: matchingIds, groups });
  }
  return concerns;
}

// ---------------------------------------------------------------------------
// Build catalog
// ---------------------------------------------------------------------------

export function buildCatalog(stories: RoadmapStory[], landscapeSections: Record<string, string>): RoadmapCatalog {
  const storyMap = new Map(stories.map((s) => [s.id, s]));

  const groupMap = new Map<string, RoadmapStory[]>();
  for (const story of stories) {
    const list = groupMap.get(story.group) || [];
    list.push(story);
    groupMap.set(story.group, list);
  }

  const groups: RoadmapGroup[] = [];
  for (const [groupId, groupStories] of groupMap) {
    const storyIds = groupStories.map((s) => s.id);
    groups.push({
      id: groupId,
      name: GROUP_NAMES[groupId] ?? groupId,
      stories: storyIds,
      progress: {
        total: groupStories.length,
        done: groupStories.filter((s) => s.status === "merged").length,
        inProgress: groupStories.filter((s) => s.status === "in-progress").length,
        review: groupStories.filter((s) => s.status === "review").length,
      },
      criticalPath: computeCriticalPath(storyIds, storyMap),
      nextUnblocked: computeNextUnblocked(storyIds, storyMap),
    });
  }

  const groupOrder = Object.keys(GROUP_NAMES);
  groups.sort((a, b) => {
    const ai = groupOrder.indexOf(a.id);
    const bi = groupOrder.indexOf(b.id);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const byPriority: Record<string, number> = {};
  const byScope: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const s of stories) {
    byPriority[s.priority] = (byPriority[s.priority] || 0) + 1;
    if (s.scope) byScope[s.scope] = (byScope[s.scope] || 0) + 1;
    byStatus[s.status] = (byStatus[s.status] || 0) + 1;
  }

  const waveMap = new Map<number, { total: number; done: number }>();
  for (const s of stories) {
    const entry = waveMap.get(s.wave) || { total: 0, done: 0 };
    entry.total++;
    if (s.status === "merged") entry.done++;
    waveMap.set(s.wave, entry);
  }
  const waves: WaveStats[] = [...waveMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([wave, stats]) => ({ wave, ...stats }));

  const sharedConcerns = computeSharedConcerns(stories);
  const catalogStories = stories.map(({ markdown: _md, ...rest }) => rest);

  return {
    groups,
    stories: catalogStories,
    generatedAt: Date.now(),
    stats: { total: stories.length, byPriority, byScope, byStatus },
    waves,
    sharedConcerns,
    landscapeSections,
  };
}

// ---------------------------------------------------------------------------
// Read stories from disk
// ---------------------------------------------------------------------------

export const STORIES_DIR = "stories";

export async function readStories(storiesDir = STORIES_DIR): Promise<RoadmapStory[]> {
  const stories: RoadmapStory[] = [];

  const files: string[] = [];
  for await (const entry of Deno.readDir(storiesDir)) {
    if (entry.isFile && entry.name.endsWith(".md")) {
      files.push(entry.name);
    }
  }
  files.sort();

  for (const filename of files) {
    const filePath = `${storiesDir}/${filename}`;
    const content = await Deno.readTextFile(filePath);
    const { meta, body } = parseFrontmatter(content);

    if (!meta.id) continue;

    const id = asString(meta.id, filename.replace(/\.md$/, ""));
    const uri = `mutable://open/rig/roadmap/stories/${id}`;

    stories.push({
      id,
      title: asString(meta.title, id),
      group: asString(meta.group, "uncategorized"),
      category: asString(meta.category, ""),
      section: asString(meta.section, ""),
      dependsOn: asStringArray(meta.depends_on),
      blocks: asStringArray(meta.blocks),
      priority: asString(meta.priority, "medium") as RoadmapStory["priority"],
      scope: asString(meta.scope, ""),
      estimatedPrs: asNumber(meta.estimated_prs, 1),
      filesInvolved: asStringArray(meta.files_involved),
      tags: asStringArray(meta.tags),
      status: "pending",
      uri,
      markdown: body,
      wave: 0,
      keywords: extractKeywords(body),
    });
  }

  return stories;
}

// ---------------------------------------------------------------------------
// GitHub PR status + review comments
// ---------------------------------------------------------------------------

export async function fetchPRs(): Promise<GitHubPR[]> {
  try {
    const cmd = new Deno.Command("gh", {
      args: ["pr", "list", "--json", "number,title,headRefName,state,url", "--limit", "200", "--state", "all"],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    if (!output.success) {
      console.warn("  gh pr list failed, skipping PR status");
      return [];
    }
    const text = new TextDecoder().decode(output.stdout);
    return JSON.parse(text) as GitHubPR[];
  } catch {
    console.warn("  gh CLI not available, skipping PR status");
    return [];
  }
}

export async function fetchPRComments(prNumber: number): Promise<PRComment[]> {
  try {
    const cmd = new Deno.Command("gh", {
      args: ["pr", "view", String(prNumber), "--json", "reviews,comments"],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    if (!output.success) return [];
    const text = new TextDecoder().decode(output.stdout);
    const data = JSON.parse(text) as GitHubPRDetail;
    const comments: PRComment[] = [];
    for (const r of (data.reviews || [])) {
      if (r.body?.trim()) {
        comments.push({ author: r.author?.login ?? "unknown", body: r.body, createdAt: r.createdAt });
      }
    }
    for (const c of (data.comments || [])) {
      if (c.body?.trim()) {
        comments.push({ author: c.author?.login ?? "unknown", body: c.body, createdAt: c.createdAt });
      }
    }
    return comments;
  } catch {
    return [];
  }
}

export function matchPRsToStories(stories: RoadmapStory[], prs: GitHubPR[]): void {
  const branchMap = new Map<string, GitHubPR>();
  for (const pr of prs) {
    branchMap.set(pr.headRefName, pr);
  }

  for (const story of stories) {
    const branchName = `story/${story.id.toLowerCase()}`;
    let pr = branchMap.get(branchName);

    if (!pr) {
      const idLower = story.id.toLowerCase();
      for (const [branch, candidate] of branchMap) {
        if (branch.toLowerCase().includes(idLower)) {
          pr = candidate;
          break;
        }
      }
    }

    if (pr) {
      story.pr = {
        number: pr.number,
        url: pr.url,
        state: pr.state,
        title: pr.title,
      };

      if (pr.state === "MERGED") {
        story.status = "merged";
      } else if (pr.state === "OPEN") {
        story.status = "in-progress";
      } else if (pr.state === "CLOSED") {
        story.status = "pending";
      }
    }
  }
}

export async function enrichPRComments(stories: RoadmapStory[]): Promise<void> {
  const withPRs = stories.filter((s) => s.pr);
  console.log(`  Fetching review comments for ${withPRs.length} PRs...`);
  for (const story of withPRs) {
    if (story.pr) {
      const comments = await fetchPRComments(story.pr.number);
      if (comments.length > 0) {
        story.prComments = comments;
      }
    }
  }
  const withComments = stories.filter((s) => s.prComments && s.prComments.length > 0).length;
  console.log(`  Found comments on ${withComments} PRs`);
}

// ---------------------------------------------------------------------------
// Parse TASKS.md for excerpts
// ---------------------------------------------------------------------------

export async function parseTasksExcerpts(): Promise<Map<string, string>> {
  const excerpts = new Map<string, string>();
  try {
    const content = await Deno.readTextFile("TASKS.md");
    const sections = content.split(/(?=^### [A-G]\d+\.)/m);
    for (const section of sections) {
      const headerMatch = section.match(/^### ([A-G]\d+)\.\s+(.+)/m);
      if (!headerMatch) continue;
      const sectionId = headerMatch[1];
      const body = section.slice(headerMatch[0].length).trim();
      const lines = body.split("\n").slice(0, 15);
      excerpts.set(sectionId, lines.join("\n").trim().slice(0, 500));
    }
  } catch {
    console.warn("  TASKS.md not found, skipping excerpts");
  }
  return excerpts;
}

export function matchTasksExcerpts(stories: RoadmapStory[], excerpts: Map<string, string>): void {
  for (const story of stories) {
    if (story.section) {
      const excerpt = excerpts.get(story.section);
      if (excerpt) {
        story.tasksExcerpt = excerpt;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Parse LANDSCAPE.md for group excerpts
// ---------------------------------------------------------------------------

export async function parseLandscapeSections(): Promise<Record<string, string>> {
  const sections: Record<string, string> = {};
  try {
    const content = await Deno.readTextFile("LANDSCAPE.md");
    const activeFrontsMatch = content.match(/## (?:\d+\.\s*)?Active Fronts([\s\S]*?)(?=^## |\Z)/m);
    if (activeFrontsMatch) {
      const body = activeFrontsMatch[1];
      const domainSections = body.split(/(?=^### [A-G]\.)/m);
      for (const ds of domainSections) {
        const headerMatch = ds.match(/^### ([A-G])\.\s+(.+)/m);
        if (!headerMatch) continue;
        const domainCode = headerMatch[1];
        const excerpt = ds.slice(headerMatch[0].length).trim().slice(0, 600);
        for (const [sectionPrefix, groupId] of Object.entries(SECTION_TO_GROUP)) {
          if (sectionPrefix.startsWith(domainCode) && !sections[groupId]) {
            sections[groupId] = `**${headerMatch[2].trim()}**\n${excerpt}`;
          }
        }
      }
    }

    for (const [groupId, groupName] of Object.entries(GROUP_NAMES)) {
      if (sections[groupId]) continue;
      const groupRegex = new RegExp(`(?:^|\\n).*${groupName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*(?:\\n|$)([\\s\\S]{0,400})`, "i");
      const groupMatch = content.match(groupRegex);
      if (groupMatch) {
        sections[groupId] = groupMatch[0].trim().slice(0, 400);
      }
    }
  } catch {
    console.warn("  LANDSCAPE.md not found, skipping excerpts");
  }
  return sections;
}

// ---------------------------------------------------------------------------
// Static file output
// ---------------------------------------------------------------------------

async function ensureDir(dir: string): Promise<void> {
  try { await Deno.mkdir(dir, { recursive: true }); } catch { /* exists */ }
}

export async function writeStaticFiles(catalog: RoadmapCatalog, stories: RoadmapStory[]): Promise<void> {
  const baseDir = "apps/b3nd-web-rig/public/roadmap";
  const storiesDir = `${baseDir}/stories`;
  await ensureDir(storiesDir);

  const catalogJson = JSON.stringify(catalog, null, 2);
  await Deno.writeTextFile(`${baseDir}/catalog.json`, catalogJson);
  console.log(`\nStatic catalog written to ${baseDir}/catalog.json (${(catalogJson.length / 1024).toFixed(1)} KB)`);

  for (const story of stories) {
    const storyJson = JSON.stringify(story, null, 2);
    await Deno.writeTextFile(`${storiesDir}/${story.id}.json`, storyJson);
  }
  console.log(`  ${stories.length} story files written to ${storiesDir}/`);
}

// ---------------------------------------------------------------------------
// B3nd upload
// ---------------------------------------------------------------------------

export async function uploadToB3nd(nodeUrl: string, catalog: RoadmapCatalog, stories: RoadmapStory[]): Promise<boolean> {
  console.log(`\nUploading to B3nd at ${nodeUrl}...`);

  try {
    const catalogRes = await fetch(`${nodeUrl}/api/v1/receive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["mutable://open/rig/roadmap/catalog", catalog]),
    });
    if (!catalogRes.ok) {
      console.warn(`  Catalog upload failed: ${catalogRes.status}`);
      return false;
    }
    console.log("  Catalog uploaded.");

    for (const story of stories) {
      const res = await fetch(`${nodeUrl}/api/v1/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([story.uri, story]),
      });
      if (res.ok) {
        console.log(`  Story "${story.id}" → ${story.uri}`);
      } else {
        console.warn(`  Story "${story.id}" upload failed: ${res.status}`);
      }
    }

    return true;
  } catch (e) {
    console.warn(`  B3nd upload failed: ${e}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Generate frontmatter from story object (reverse of parseFrontmatter)
// ---------------------------------------------------------------------------

export function generateFrontmatter(story: RoadmapStory): string {
  const lines: string[] = ["---"];

  lines.push(`id: "${story.id}"`);
  lines.push(`title: "${story.title}"`);
  lines.push(`group: "${story.group}"`);
  lines.push(`category: "${story.category}"`);
  lines.push(`section: "${story.section}"`);

  // depends_on
  if (story.dependsOn.length === 0) {
    lines.push("depends_on: []");
  } else {
    lines.push("depends_on:");
    for (const dep of story.dependsOn) lines.push(`  - "${dep}"`);
  }

  // blocks
  if (story.blocks.length === 0) {
    lines.push("blocks: []");
  } else {
    lines.push("blocks:");
    for (const b of story.blocks) lines.push(`  - "${b}"`);
  }

  lines.push(`priority: "${story.priority}"`);
  lines.push(`scope: "${story.scope}"`);
  lines.push(`estimated_prs: ${story.estimatedPrs}`);

  // files_involved
  if (story.filesInvolved.length === 0) {
    lines.push("files_involved: []");
  } else {
    lines.push("files_involved:");
    for (const f of story.filesInvolved) lines.push(`  - "${f}"`);
  }

  // tags
  if (story.tags.length === 0) {
    lines.push("tags: []");
  } else {
    lines.push("tags:");
    for (const t of story.tags) lines.push(`  - "${t}"`);
  }

  lines.push("---");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Write story to disk as markdown file
// ---------------------------------------------------------------------------

export async function writeStoryToFile(story: RoadmapStory, storiesDir = STORIES_DIR): Promise<string> {
  const slug = story.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const filename = `${story.id}-${slug}.md`;
  const filePath = `${storiesDir}/${filename}`;

  const frontmatter = generateFrontmatter(story);
  const content = `${frontmatter}\n${story.markdown}`;
  await Deno.writeTextFile(filePath, content);

  return filePath;
}

// ---------------------------------------------------------------------------
// Find existing story file on disk by ID
// ---------------------------------------------------------------------------

export async function findStoryFile(storyId: string, storiesDir = STORIES_DIR): Promise<string | null> {
  try {
    for await (const entry of Deno.readDir(storiesDir)) {
      if (entry.isFile && entry.name.endsWith(".md") && entry.name.startsWith(storyId)) {
        return `${storiesDir}/${entry.name}`;
      }
    }
  } catch {
    // directory doesn't exist
  }
  return null;
}
