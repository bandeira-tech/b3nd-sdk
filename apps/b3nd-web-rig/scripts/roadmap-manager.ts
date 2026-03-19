/**
 * roadmap-manager.ts
 *
 * Long-running service that polls for roadmap commands from b3nd and
 * executes them. The browser rig writes commands; this service reads
 * them and writes responses — both via the b3nd node HTTP API.
 *
 * Usage:
 *   DENO_NO_PACKAGE_JSON=1 deno run -A apps/b3nd-web-rig/scripts/roadmap-manager.ts
 *
 * Environment variables:
 *   B3ND_NODE_URL  — B3nd HTTP API base (default: http://localhost:9942)
 */

import {
  readStories,
  fetchPRs,
  matchPRsToStories,
  enrichPRComments,
  computeWaves,
  parseTasksExcerpts,
  matchTasksExcerpts,
  parseLandscapeSections,
  buildCatalog,
  writeStaticFiles,
  uploadToB3nd,
  generateFrontmatter,
  writeStoryToFile,
  findStoryFile,
  parseFrontmatter,
  asString,
  asStringArray,
  asNumber,
  STORIES_DIR,
  type RoadmapStory,
  type RoadmapCatalog,
} from "./roadmap-lib.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RoadmapCommand {
  type: "rebuild" | "pull" | "push" | "create-story" | "update-story";
  requestId: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

interface RoadmapResponse {
  requestId: string;
  success: boolean;
  error?: string;
  data?: unknown;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// B3nd HTTP helpers
// ---------------------------------------------------------------------------

const NODE_URL = Deno.env.get("B3ND_NODE_URL") ?? "http://localhost:9942";
const CMD_PREFIX = "mutable://open/rig/roadmap/cmd/";
const RES_PREFIX = "mutable://open/rig/roadmap/res/";
const POLL_INTERVAL_MS = 1000;

async function b3ndReceive(uri: string, data: unknown): Promise<boolean> {
  try {
    const res = await fetch(`${NODE_URL}/api/v1/receive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([uri, data]),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function b3ndList(prefix: string): Promise<{ uri: string }[]> {
  try {
    const apiPath = "/api/v1/list/" + prefix.replace("://", "/");
    const res = await fetch(`${NODE_URL}${apiPath}`);
    if (!res.ok) return [];
    const json = await res.json();
    return (json.data ?? json ?? []) as { uri: string }[];
  } catch {
    return [];
  }
}

async function b3ndRead<T = unknown>(uri: string): Promise<T | null> {
  try {
    const apiPath = "/api/v1/read/" + uri.replace("://", "/");
    const res = await fetch(`${NODE_URL}${apiPath}`);
    if (!res.ok) return null;
    const json = await res.json();
    return (json.data ?? json) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

async function handleRebuild(payload: Record<string, unknown>): Promise<RoadmapResponse & { data?: unknown }> {
  const skipPRs = !!payload.skipPRs;

  console.log("  [rebuild] Reading stories...");
  const stories = await readStories();
  console.log(`  [rebuild] Found ${stories.length} stories`);

  if (!skipPRs) {
    console.log("  [rebuild] Fetching PRs...");
    const prs = await fetchPRs();
    matchPRsToStories(stories, prs);
    await enrichPRComments(stories);
  }

  computeWaves(stories);

  const tasksExcerpts = await parseTasksExcerpts();
  matchTasksExcerpts(stories, tasksExcerpts);
  const landscapeSections = await parseLandscapeSections();

  const catalog = buildCatalog(stories, landscapeSections);

  await writeStaticFiles(catalog, stories);
  await uploadToB3nd(NODE_URL, catalog, stories);

  return {
    requestId: "",
    success: true,
    data: {
      stories: catalog.stories.length,
      groups: catalog.groups.length,
      waves: catalog.waves.length,
    },
    timestamp: Date.now(),
  };
}

async function handlePull(): Promise<RoadmapResponse & { data?: unknown }> {
  console.log("  [pull] Reading stories from disk...");
  const stories = await readStories();
  computeWaves(stories);

  const landscapeSections = await parseLandscapeSections();
  const catalog = buildCatalog(stories, landscapeSections);

  await uploadToB3nd(NODE_URL, catalog, stories);

  return {
    requestId: "",
    success: true,
    data: { stories: stories.length },
    timestamp: Date.now(),
  };
}

async function handlePush(payload: Record<string, unknown>): Promise<RoadmapResponse & { data?: unknown }> {
  const storyIds = payload.storyIds as string[] | undefined;
  console.log("  [push] Reading stories from b3nd...");

  // Get catalog to find all story IDs
  const catalog = await b3ndRead<RoadmapCatalog>("mutable://open/rig/roadmap/catalog");
  if (!catalog) {
    return { requestId: "", success: false, error: "No catalog found in b3nd", timestamp: Date.now() };
  }

  const ids = storyIds ?? catalog.stories.map((s) => s.id);
  let written = 0;

  for (const id of ids) {
    const story = await b3ndRead<RoadmapStory>(`mutable://open/rig/roadmap/stories/${id}`);
    if (!story) {
      console.warn(`  [push] Story ${id} not found in b3nd, skipping`);
      continue;
    }
    await writeStoryToFile(story);
    written++;
    console.log(`  [push] Wrote ${id} to disk`);
  }

  return {
    requestId: "",
    success: true,
    data: { written },
    timestamp: Date.now(),
  };
}

async function handleCreateStory(payload: Record<string, unknown>): Promise<RoadmapResponse & { data?: unknown }> {
  const id = payload.id as string;
  if (!id) {
    return { requestId: "", success: false, error: "Missing story id", timestamp: Date.now() };
  }

  // Check if story already exists
  const existing = await findStoryFile(id);
  if (existing) {
    return { requestId: "", success: false, error: `Story ${id} already exists at ${existing}`, timestamp: Date.now() };
  }

  const story: RoadmapStory = {
    id,
    title: (payload.title as string) ?? id,
    group: (payload.group as string) ?? "uncategorized",
    category: (payload.category as string) ?? "",
    section: (payload.section as string) ?? "",
    dependsOn: (payload.dependsOn as string[]) ?? [],
    blocks: (payload.blocks as string[]) ?? [],
    priority: ((payload.priority as string) ?? "medium") as RoadmapStory["priority"],
    scope: (payload.scope as string) ?? "",
    estimatedPrs: (payload.estimatedPrs as number) ?? 1,
    filesInvolved: (payload.filesInvolved as string[]) ?? [],
    tags: (payload.tags as string[]) ?? [],
    status: "pending",
    uri: `mutable://open/rig/roadmap/stories/${id}`,
    markdown: (payload.markdown as string) ?? `\n## Goal\n\nTODO: describe the goal of this story.\n`,
    wave: 0,
    keywords: [],
  };

  const filePath = await writeStoryToFile(story);
  console.log(`  [create-story] Created ${filePath}`);

  // Upload to b3nd
  await b3ndReceive(story.uri, story);

  return {
    requestId: "",
    success: true,
    data: { id, filePath },
    timestamp: Date.now(),
  };
}

async function handleUpdateStory(payload: Record<string, unknown>): Promise<RoadmapResponse & { data?: unknown }> {
  const id = payload.id as string;
  const fields = payload.fields as Record<string, unknown> | undefined;
  if (!id || !fields) {
    return { requestId: "", success: false, error: "Missing id or fields", timestamp: Date.now() };
  }

  // Read from disk
  const filePath = await findStoryFile(id);
  if (!filePath) {
    return { requestId: "", success: false, error: `Story file for ${id} not found on disk`, timestamp: Date.now() };
  }

  const content = await Deno.readTextFile(filePath);
  const { meta, body } = parseFrontmatter(content);

  // Merge fields into meta
  const fieldMap: Record<string, string> = {
    title: "title",
    group: "group",
    category: "category",
    section: "section",
    priority: "priority",
    scope: "scope",
    estimatedPrs: "estimated_prs",
    status: "status",
  };

  for (const [key, val] of Object.entries(fields)) {
    const metaKey = fieldMap[key] ?? key;
    meta[metaKey] = val;
  }

  // Rebuild story object
  const story: RoadmapStory = {
    id: asString(meta.id, id),
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
    status: (asString(meta.status, "pending") as RoadmapStory["status"]),
    uri: `mutable://open/rig/roadmap/stories/${id}`,
    markdown: body,
    wave: 0,
    keywords: [],
  };

  // Write back to disk (overwrite existing file)
  const frontmatter = generateFrontmatter(story);
  await Deno.writeTextFile(filePath, `${frontmatter}\n${body}`);
  console.log(`  [update-story] Updated ${filePath}`);

  // Upload to b3nd
  await b3ndReceive(story.uri, story);

  return {
    requestId: "",
    success: true,
    data: { id, updated: Object.keys(fields) },
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Poll loop
// ---------------------------------------------------------------------------

async function processCommand(cmd: RoadmapCommand): Promise<RoadmapResponse> {
  console.log(`\n[${new Date().toISOString()}] Processing command: ${cmd.type} (${cmd.requestId})`);

  let result: RoadmapResponse;
  try {
    switch (cmd.type) {
      case "rebuild":
        result = await handleRebuild(cmd.payload);
        break;
      case "pull":
        result = await handlePull();
        break;
      case "push":
        result = await handlePush(cmd.payload);
        break;
      case "create-story":
        result = await handleCreateStory(cmd.payload);
        break;
      case "update-story":
        result = await handleUpdateStory(cmd.payload);
        break;
      default:
        result = { requestId: cmd.requestId, success: false, error: `Unknown command: ${cmd.type}`, timestamp: Date.now() };
    }
  } catch (err) {
    result = {
      requestId: cmd.requestId,
      success: false,
      error: err instanceof Error ? err.message : String(err),
      timestamp: Date.now(),
    };
  }

  result.requestId = cmd.requestId;
  return result;
}

async function main() {
  console.log("=== B3nd Roadmap Manager ===");
  console.log(`  Node: ${NODE_URL}`);
  console.log(`  Watching: ${CMD_PREFIX}`);
  console.log(`  Poll interval: ${POLL_INTERVAL_MS}ms`);
  console.log("");

  const processed = new Set<string>();

  while (true) {
    try {
      const items = await b3ndList(CMD_PREFIX);

      for (const item of items) {
        if (processed.has(item.uri)) continue;

        const cmd = await b3ndRead<RoadmapCommand>(item.uri);
        if (!cmd || !cmd.type || !cmd.requestId) {
          processed.add(item.uri);
          continue;
        }

        const response = await processCommand(cmd);

        // Write response
        const resUri = `${RES_PREFIX}${cmd.requestId}`;
        const ok = await b3ndReceive(resUri, response);
        if (ok) {
          console.log(`  Response written to ${resUri} (success=${response.success})`);
        } else {
          console.warn(`  Failed to write response to ${resUri}`);
        }

        processed.add(item.uri);
      }
    } catch (err) {
      console.warn(`  Poll error: ${err}`);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main();
