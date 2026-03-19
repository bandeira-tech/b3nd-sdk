// ---------------------------------------------------------------------------
// Roadmap catalog types — runtime data loaded from B3nd or static JSON
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

/** Story metadata without markdown content (used in catalog listing). */
export type RoadmapStoryMeta = Omit<RoadmapStory, "markdown">;

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
  stories: RoadmapStoryMeta[];
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

// ---------------------------------------------------------------------------
// Priority config
// ---------------------------------------------------------------------------

export const PRIORITY_ORDER = ["critical", "high", "medium", "low"] as const;

export const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  low: "bg-blue-400",
};

export const STATUS_COLORS: Record<string, string> = {
  pending: "bg-zinc-400",
  "in-progress": "bg-blue-500",
  review: "bg-purple-500",
  merged: "bg-green-500",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function findStory(stories: RoadmapStoryMeta[], id: string): RoadmapStoryMeta | undefined {
  return stories.find((s) => s.id === id);
}

export function storiesByGroup(stories: RoadmapStoryMeta[], groupId: string): RoadmapStoryMeta[] {
  return stories.filter((s) => s.group === groupId);
}

/** Returns the local neighborhood of a story within N hops of dependencies. */
export function getSubgraph(
  stories: RoadmapStoryMeta[],
  focusId: string,
  hops: number,
): { nodes: RoadmapStoryMeta[]; edges: { from: string; to: string }[] } {
  const storyMap = new Map(stories.map((s) => [s.id, s]));
  const visited = new Set<string>();
  const edges: { from: string; to: string }[] = [];

  function walk(id: string, depth: number) {
    if (visited.has(id) || depth > hops) return;
    visited.add(id);
    const s = storyMap.get(id);
    if (!s) return;
    for (const dep of s.dependsOn) {
      edges.push({ from: dep, to: id });
      walk(dep, depth + 1);
    }
    for (const blocked of s.blocks) {
      edges.push({ from: id, to: blocked });
      walk(blocked, depth + 1);
    }
  }

  walk(focusId, 0);

  const nodes = [...visited].map((id) => storyMap.get(id)).filter(Boolean) as RoadmapStoryMeta[];
  const uniqueEdges = edges.filter(
    (e, i, arr) => arr.findIndex((x) => x.from === e.from && x.to === e.to) === i,
  );
  return { nodes, edges: uniqueEdges };
}
