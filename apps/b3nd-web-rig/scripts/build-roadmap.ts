/**
 * build-roadmap.ts
 *
 * Reads story card markdown files from stories/, parses YAML frontmatter,
 * fetches GitHub PR status + review comments, computes dependency waves,
 * extracts keywords, parses LANDSCAPE.md & TASKS.md excerpts, builds an
 * enriched RoadmapCatalog, and outputs:
 *   - Static JSON to apps/b3nd-web-rig/public/roadmap/
 *   - Uploads to B3nd node at mutable://open/rig/roadmap/
 *
 * Usage:
 *   DENO_NO_PACKAGE_JSON=1 deno run -A apps/b3nd-web-rig/scripts/build-roadmap.ts
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
  STORIES_DIR,
} from "./roadmap-lib.ts";

async function main() {
  console.log("=== B3nd Roadmap Builder (v2 — Coordination Hub) ===\n");

  console.log(`Reading ${STORIES_DIR}/...`);
  const stories = await readStories();
  console.log(`  Found ${stories.length} stories`);

  console.log("\nFetching GitHub PR status...");
  const prs = await fetchPRs();
  console.log(`  Found ${prs.length} PRs`);
  matchPRsToStories(stories, prs);

  const withPR = stories.filter((s) => s.pr).length;
  console.log(`  Matched ${withPR} stories to PRs`);

  // Enrich with PR review comments
  await enrichPRComments(stories);

  // Compute dependency waves
  console.log("\nComputing dependency waves...");
  computeWaves(stories);
  const maxWave = Math.max(...stories.map((s) => s.wave), 0);
  console.log(`  Computed ${maxWave + 1} waves (0..${maxWave})`);

  // Parse doc excerpts
  console.log("\nParsing TASKS.md excerpts...");
  const tasksExcerpts = await parseTasksExcerpts();
  console.log(`  Found ${tasksExcerpts.size} section excerpts`);
  matchTasksExcerpts(stories, tasksExcerpts);

  console.log("Parsing LANDSCAPE.md sections...");
  const landscapeSections = await parseLandscapeSections();
  console.log(`  Found ${Object.keys(landscapeSections).length} group excerpts`);

  const catalog = buildCatalog(stories, landscapeSections);

  console.log(`\nCatalog: ${catalog.groups.length} groups, ${catalog.stories.length} stories`);
  for (const g of catalog.groups) {
    console.log(`  [${g.id}] ${g.name} — ${g.stories.length} stories (${g.progress.done} done, ${g.progress.inProgress} wip, ${g.nextUnblocked.length} unblocked)`);
  }
  console.log(`  ${catalog.waves.length} waves, ${catalog.sharedConcerns.length} shared concerns`);

  await writeStaticFiles(catalog, stories);

  const nodeUrl = Deno.env.get("B3ND_NODE_URL") ?? "http://localhost:9942";
  await uploadToB3nd(nodeUrl, catalog, stories);

  console.log("\nDone.");
}

main();
