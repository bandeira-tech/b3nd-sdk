import { useRef, useEffect, useMemo, useState, useCallback, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  Loader2, ArrowLeft, ExternalLink, GitPullRequest,
  ArrowRight, ChevronRight, Copy, Check, MessageSquare,
  Zap, Send, XCircle, Wifi, WifiOff, Pencil, Save,
  RefreshCw, Download, Upload, Plus, X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn, routeForExplorerPath } from "../../utils";
import { useAppStore } from "../../stores/appStore";
import { useRoadmapStore } from "./useRoadmapStore";
import { useRead } from "../learn/useRead";
import { RoadmapRightPanel } from "./RoadmapRightPanel";
import {
  PRIORITY_COLORS, PRIORITY_ORDER, STATUS_COLORS,
  getSubgraph,
  type RoadmapCatalog, type RoadmapStory, type RoadmapStoryMeta,
} from "./roadmapTypes";
import {
  useAgentRelayStore,
  useAgentRelayConnection,
  useAgentRelayActions,
} from "./useAgentRelay";
import {
  TerminalOutput, ElapsedTime, SessionStatusIcon,
  sessionStatusLabel, outputLineCount,
} from "./AgentTerminal";
import { useRoadmapCommands } from "./useRoadmapCommands";

const CATALOG_URI = "mutable://open/rig/roadmap/catalog";
const EMPTY_LINES: string[] = [];

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/* -- Root --------------------------------------------------------------- */

export function RoadmapLayoutSlot() {
  const panels = useAppStore((s) => s.panels);
  const rightPanelOpen = panels.right;

  // Connect to agent relay WebSocket while roadmap is active
  useAgentRelayConnection();

  return (
    <div className="h-full flex overflow-hidden bg-background text-foreground">
      <div className="flex-1 overflow-hidden">
        <RoadmapMainContent />
      </div>
      {rightPanelOpen && (
        <div className="w-[320px] border-l border-border bg-card shrink-0">
          <RoadmapRightPanel />
        </div>
      )}
    </div>
  );
}

function RoadmapMainContent() {
  const activeStory = useRoadmapStore((s) => s.activeStory);
  const viewMode = useRoadmapStore((s) => s.viewMode);
  const activeTag = useRoadmapStore((s) => s.activeTag);
  const refreshKey = useRoadmapStore((s) => s.catalogRefreshKey);
  const { data: catalog, loading, error } = useRead<RoadmapCatalog>(CATALOG_URI, refreshKey);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading roadmap...</span>
      </div>
    );
  }

  if (error || !catalog) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-destructive">{error ?? "No roadmap catalog found. Run `make build-roadmap` first."}</p>
      </div>
    );
  }

  if (activeStory) {
    const storyMeta = catalog.stories.find((s) => s.id === activeStory);
    if (!storyMeta) {
      return (
        <div className="flex items-center justify-center h-full">
          <p className="text-sm text-muted-foreground">Story not found.</p>
        </div>
      );
    }
    return <StoryDetailView storyMeta={storyMeta} catalog={catalog} />;
  }

  if (viewMode === "tags" && activeTag) {
    return <TagBrowserView catalog={catalog} activeTag={activeTag} />;
  }

  return <IndexView catalog={catalog} />;
}

/* -- Index View ---------------------------------------------------------- */

function IndexView({ catalog }: { catalog: RoadmapCatalog }) {
  const openGroup = useRoadmapStore((s) => s.openGroup);
  const openStory = useRoadmapStore((s) => s.openStory);
  const activeGroup = useRoadmapStore((s) => s.activeGroup);
  const closeGroup = useRoadmapStore((s) => s.closeGroup);
  const bumpRefresh = useRoadmapStore((s) => s.bumpRefresh);
  const { rebuild, pull, push, createStory, connected } = useRoadmapCommands();

  const [syncing, setSyncing] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const handleSync = useCallback(async (action: string, fn: () => Promise<{ success: boolean; error?: string }>) => {
    setSyncing(action);
    const result = await fn();
    setSyncing(null);
    if (result.success) bumpRefresh();
    else console.warn(`Sync ${action} failed:`, result.error);
  }, [bumpRefresh]);

  return (
    <div className="max-w-4xl mx-auto px-8 py-10 h-full overflow-y-auto custom-scrollbar">
      {activeGroup && (
        <button
          onClick={closeGroup}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          All Groups
        </button>
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Roadmap</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {catalog.stats.total} stories across {catalog.groups.length} groups
          </p>
        </div>

        {connected && (
          <div className="flex items-center gap-1.5">
            <SyncButton
              icon={<Download className="w-3 h-3" />}
              label="Pull"
              loading={syncing === "pull"}
              disabled={!!syncing}
              onClick={() => handleSync("pull", pull)}
            />
            <SyncButton
              icon={<Upload className="w-3 h-3" />}
              label="Push"
              loading={syncing === "push"}
              disabled={!!syncing}
              onClick={() => handleSync("push", () => push())}
            />
            <SyncButton
              icon={<RefreshCw className="w-3 h-3" />}
              label="Rebuild"
              loading={syncing === "rebuild"}
              disabled={!!syncing}
              onClick={() => handleSync("rebuild", () => rebuild())}
            />
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1 px-2 py-1.5 rounded text-[10px] font-medium bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
            >
              <Plus className="w-3 h-3" />
              New Story
            </button>
          </div>
        )}
      </div>

      {showCreate && (
        <CreateStoryDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); bumpRefresh(); }}
          createStory={createStory}
        />
      )}

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total" value={catalog.stats.total} />
        <StatCard label="In Progress" value={catalog.stats.byStatus["in-progress"] || 0} color="text-blue-500" />
        <StatCard label="Merged" value={catalog.stats.byStatus["merged"] || 0} color="text-green-500" />
        <StatCard label="Critical" value={catalog.stats.byPriority["critical"] || 0} color="text-red-500" />
      </div>

      {/* Priority breakdown */}
      <div className="flex gap-1 mb-4 h-2 rounded-full overflow-hidden bg-accent/30">
        {PRIORITY_ORDER.map((p) => {
          const count = catalog.stats.byPriority[p] || 0;
          if (!count) return null;
          const pct = (count / catalog.stats.total) * 100;
          return (
            <div
              key={p}
              className={cn("h-full", PRIORITY_COLORS[p])}
              style={{ width: `${pct}%` }}
              title={`${p}: ${count}`}
            />
          );
        })}
      </div>

      {/* Wave progress bar */}
      {catalog.waves && catalog.waves.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Waves</span>
          </div>
          <div className="flex gap-1 h-3 rounded-full overflow-hidden bg-accent/20">
            {catalog.waves.map((w) => {
              const pct = (w.total / catalog.stats.total) * 100;
              const donePct = w.total > 0 ? (w.done / w.total) * 100 : 0;
              return (
                <div
                  key={w.wave}
                  className="relative h-full bg-accent/40 overflow-hidden"
                  style={{ width: `${pct}%` }}
                  title={`Wave ${w.wave}: ${w.done}/${w.total}`}
                >
                  <div
                    className="absolute inset-y-0 left-0 bg-primary/60"
                    style={{ width: `${donePct}%` }}
                  />
                  <span className="absolute inset-0 flex items-center justify-center text-[8px] font-mono text-foreground/70">
                    {w.wave}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Group cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {catalog.groups
          .filter((g) => !activeGroup || g.id === activeGroup)
          .map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              stories={catalog.stories.filter((s) => s.group === group.id)}
              onClickGroup={() => openGroup(group.id)}
              onClickStory={(id) => openStory(id)}
              expanded={activeGroup === group.id}
            />
          ))}
      </div>
    </div>
  );
}

/* -- Sync Button --------------------------------------------------------- */

function SyncButton({
  icon, label, loading, disabled, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-1 px-2 py-1.5 rounded text-[10px] font-medium transition-colors",
        disabled
          ? "text-muted-foreground/40 cursor-not-allowed"
          : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
      )}
    >
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : icon}
      {label}
    </button>
  );
}

/* -- Create Story Dialog ------------------------------------------------- */

const GROUP_OPTIONS = [
  { value: "apps-possible", label: "Make Apps Possible" },
  { value: "nodes-talk", label: "Nodes Talk" },
  { value: "make-it-pay", label: "Make It Pay" },
  { value: "platform-features", label: "Platform Features" },
  { value: "tell-the-story", label: "Tell the Story" },
];

function CreateStoryDialog({
  onClose, onCreated, createStory,
}: {
  onClose: () => void;
  onCreated: () => void;
  createStory: (payload: {
    id: string; title: string; group: string;
    category?: string; section?: string; priority?: string; tags?: string[];
  }) => Promise<{ success: boolean; error?: string }>;
}) {
  const [id, setId] = useState("");
  const [title, setTitle] = useState("");
  const [group, setGroup] = useState("apps-possible");
  const [priority, setPriority] = useState("medium");
  const [section, setSection] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    if (!id.trim() || !title.trim()) return;
    setSubmitting(true);
    setError(null);
    const result = await createStory({ id: id.trim(), title: title.trim(), group, priority, section: section.trim() });
    setSubmitting(false);
    if (result.success) {
      onCreated();
    } else {
      setError(result.error ?? "Failed to create story");
    }
  }, [id, title, group, priority, section, createStory, onCreated]);

  return (
    <div className="border border-border rounded-lg p-4 mb-6 bg-card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-foreground">New Story</h3>
        <button onClick={onClose} className="p-1 rounded hover:bg-accent transition-colors">
          <X className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-1">ID</label>
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="G1-A4-04"
            className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded outline-none focus:border-primary/50"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-1">Section</label>
          <input
            value={section}
            onChange={(e) => setSection(e.target.value)}
            placeholder="A4"
            className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded outline-none focus:border-primary/50"
          />
        </div>
      </div>
      <div className="mb-3">
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-1">Title</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Describe the story"
          className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded outline-none focus:border-primary/50"
        />
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-1">Group</label>
          <select
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded outline-none focus:border-primary/50"
          >
            {GROUP_OPTIONS.map((g) => (
              <option key={g.value} value={g.value}>{g.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-1">Priority</label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded outline-none focus:border-primary/50"
          >
            {PRIORITY_ORDER.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
      </div>
      {error && <p className="text-[10px] text-red-400 mb-2">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!id.trim() || !title.trim() || submitting}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors",
            !id.trim() || !title.trim() || submitting
              ? "text-muted-foreground/40 cursor-not-allowed"
              : "bg-primary/15 text-primary hover:bg-primary/25",
          )}
        >
          {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
          Create
        </button>
      </div>
    </div>
  );
}

/* -- Tag Browser View ---------------------------------------------------- */

function TagBrowserView({ catalog, activeTag }: { catalog: RoadmapCatalog; activeTag: string }) {
  const openStory = useRoadmapStore((s) => s.openStory);
  const setActiveTag = useRoadmapStore((s) => s.setActiveTag);

  const concern = catalog.sharedConcerns?.find((c) => c.tag === activeTag);
  const stories = useMemo(() => {
    if (!concern) return [];
    return concern.storyIds
      .map((id) => catalog.stories.find((s) => s.id === id))
      .filter(Boolean) as RoadmapStoryMeta[];
  }, [concern, catalog.stories]);

  return (
    <div className="max-w-4xl mx-auto px-8 py-10 h-full overflow-y-auto custom-scrollbar">
      <button
        onClick={() => setActiveTag(null)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        All Tags
      </button>

      <h1 className="text-2xl font-bold text-foreground">{activeTag}</h1>
      <p className="text-sm text-muted-foreground mt-1 mb-6">
        {stories.length} stories across {concern?.groups.length ?? 0} groups
      </p>

      <div className="space-y-2">
        {stories.map((story) => (
          <button
            key={story.id}
            onClick={() => openStory(story.id)}
            className="w-full flex items-center gap-3 px-4 py-3 text-left border border-border rounded-lg hover:border-primary/40 hover:bg-accent/30 transition-colors"
          >
            <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", PRIORITY_COLORS[story.priority])} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-muted-foreground">{story.id}</span>
                <span className={cn("text-[9px] px-1.5 py-0.5 rounded-full", STATUS_COLORS[story.status] + "/20")}>
                  {story.status}
                </span>
              </div>
              <p className="text-sm text-foreground truncate">{story.title}</p>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="border border-border rounded-lg p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("text-xl font-bold", color ?? "text-foreground")}>{value}</p>
    </div>
  );
}

/* -- Group Card (with Critical Path + Next Unblocked) -------------------- */

function GroupCard({
  group, stories, onClickGroup, onClickStory, expanded,
}: {
  group: RoadmapCatalog["groups"][0];
  stories: RoadmapStoryMeta[];
  onClickGroup: () => void;
  onClickStory: (id: string) => void;
  expanded: boolean;
}) {
  const done = group.progress.done;
  const total = group.progress.total;
  const pct = total > 0 ? (done / total) * 100 : 0;
  const criticalPath = group.criticalPath ?? [];
  const nextUnblocked = group.nextUnblocked ?? [];

  // Priority dot breakdown
  const priorityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of stories) {
      counts[s.priority] = (counts[s.priority] || 0) + 1;
    }
    return counts;
  }, [stories]);

  // Current wave indicator for this group
  const groupWave = useMemo(() => {
    const waves = stories.filter((s) => s.status !== "merged").map((s) => s.wave ?? 0);
    return waves.length > 0 ? Math.min(...waves) : null;
  }, [stories]);

  return (
    <div className={cn(
      "border border-border rounded-lg transition-colors",
      expanded ? "col-span-full" : "hover:border-primary/40 hover:bg-accent/30",
    )}>
      <button
        onClick={onClickGroup}
        className="w-full text-left p-4"
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-foreground">{group.name}</span>
          <div className="flex items-center gap-2">
            {groupWave !== null && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent/60 text-muted-foreground font-mono">
                W{groupWave}
              </span>
            )}
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40" />
          </div>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-2 mb-1.5">
          <div className="flex-1 h-1.5 rounded-full bg-accent/30 overflow-hidden">
            <div className="h-full bg-green-500 rounded-full" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[10px] text-muted-foreground">{done}/{total}</span>
        </div>

        {/* Priority dot breakdown */}
        <div className="flex items-center gap-2 mb-1.5">
          {PRIORITY_ORDER.map((p) => {
            const count = priorityCounts[p];
            if (!count) return null;
            return (
              <div key={p} className="flex items-center gap-0.5">
                <span className={cn("w-1.5 h-1.5 rounded-full", PRIORITY_COLORS[p])} />
                <span className="text-[9px] text-muted-foreground">{count}</span>
              </div>
            );
          })}
        </div>

        <p className="text-[10px] text-muted-foreground">
          {group.progress.inProgress > 0 && `${group.progress.inProgress} in progress`}
          {group.progress.inProgress > 0 && group.progress.review > 0 && " · "}
          {group.progress.review > 0 && `${group.progress.review} in review`}
        </p>

        {/* Next unblocked */}
        {nextUnblocked.length > 0 && (
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            <Zap className="w-3 h-3 text-green-400 shrink-0" />
            {nextUnblocked.slice(0, 3).map((id) => (
              <span key={id} className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400 font-mono">
                {id}
              </span>
            ))}
            {nextUnblocked.length > 3 && (
              <span className="text-[9px] text-muted-foreground">+{nextUnblocked.length - 3}</span>
            )}
          </div>
        )}

        {/* Critical path */}
        {criticalPath.length > 2 && (
          <div className="mt-2 flex items-center gap-0.5 overflow-x-auto">
            {criticalPath.slice(0, 5).map((id, i) => (
              <span key={id} className="flex items-center gap-0.5">
                {i > 0 && <ArrowRight className="w-2 h-2 text-muted-foreground/30 shrink-0" />}
                <span className="text-[8px] px-1 py-0.5 rounded bg-accent/50 text-muted-foreground font-mono whitespace-nowrap shrink-0">
                  {id}
                </span>
              </span>
            ))}
            {criticalPath.length > 5 && (
              <span className="text-[8px] text-muted-foreground ml-0.5">+{criticalPath.length - 5}</span>
            )}
          </div>
        )}
      </button>

      {expanded && (
        <div className="border-t border-border px-2 py-1">
          {stories.map((story) => {
            const isUnblocked = nextUnblocked.includes(story.id);
            return (
              <button
                key={story.id}
                onClick={() => onClickStory(story.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-accent/50 rounded transition-colors"
              >
                <span className={cn("w-2 h-2 rounded-full shrink-0", PRIORITY_COLORS[story.priority])} />
                <span className="text-[10px] font-mono text-muted-foreground shrink-0 w-16">{story.id}</span>
                <span className="text-xs text-foreground truncate flex-1">{story.title}</span>
                {isUnblocked && story.status === "pending" && (
                  <span className="text-[8px] px-1 py-0.5 rounded bg-green-500/15 text-green-400 shrink-0">
                    start now
                  </span>
                )}
                <span className={cn(
                  "text-[9px] px-1.5 py-0.5 rounded-full shrink-0",
                  STATUS_COLORS[story.status] + "/20",
                )}>
                  {story.status}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* -- Story Detail View --------------------------------------------------- */

type StoryTab = "spec" | "edit" | "agent";

function StoryDetailView({ storyMeta, catalog }: { storyMeta: RoadmapStoryMeta; catalog: RoadmapCatalog }) {
  const closeStory = useRoadmapStore((s) => s.closeStory);
  const openStory = useRoadmapStore((s) => s.openStory);
  const { data: story, loading } = useRead<RoadmapStory>(storyMeta.uri);
  const containerRef = useRef<HTMLDivElement>(null);

  const sessions = useAgentRelayStore((s) => s.sessions);
  const outputs = useAgentRelayStore((s) => s.outputs);
  const session = sessions.get(storyMeta.id);
  const outputLines = outputs.get(storyMeta.id) ?? EMPTY_LINES;
  const hasSession = !!session;

  // Auto-switch to agent tab when a session starts
  const [tab, setTab] = useState<StoryTab>("spec");
  const prevSessionRef = useRef(hasSession);
  useEffect(() => {
    if (hasSession && !prevSessionRef.current) setTab("agent");
    prevSessionRef.current = hasSession;
  }, [hasSession]);

  useEffect(() => {
    containerRef.current?.scrollTo(0, 0);
  }, [storyMeta.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading story...</span>
      </div>
    );
  }

  const markdown = story?.markdown ?? "";
  const isRunning = session?.status === "running";
  const lineCount = outputLines.length > 0 ? outputLineCount(outputLines) : 0;

  // Merge PR info: session detection (live) takes precedence over catalog (static)
  const pr = session?.pr
    ? { number: session.pr.number, url: session.pr.url, state: "OPEN" as const, title: storyMeta.title }
    : storyMeta.pr;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header bar — always visible */}
      <div className="shrink-0 px-6 pt-4 pb-0">
        {/* Back + title row */}
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={closeStory}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
            <span className="text-[10px] font-mono text-muted-foreground shrink-0">{storyMeta.id}</span>
            <Badge color={PRIORITY_COLORS[storyMeta.priority]}>{storyMeta.priority}</Badge>
            {storyMeta.scope && <Badge color="bg-accent">{storyMeta.scope}</Badge>}
            <Badge color={STATUS_COLORS[storyMeta.status]}>{storyMeta.status}</Badge>
            {storyMeta.wave !== undefined && (
              <Badge color="bg-zinc-600">W{storyMeta.wave}</Badge>
            )}
          </div>
        </div>
        <h1 className="text-lg font-bold text-foreground mb-3 leading-tight">{storyMeta.title}</h1>

        {/* Agent launch controls */}
        <AgentLaunchBar storyMeta={storyMeta} story={story ?? undefined} />

        {/* Tab bar */}
        <div className="flex items-center gap-1 border-b border-border -mx-6 px-6">
          <TabBtn active={tab === "spec"} onClick={() => setTab("spec")}>
            Spec
          </TabBtn>
          <TabBtn active={tab === "edit"} onClick={() => setTab("edit")}>
            <Pencil className="w-3 h-3" /> Edit
          </TabBtn>
          <TabBtn
            active={tab === "agent"}
            onClick={() => setTab("agent")}
            badge={isRunning ? "live" : lineCount > 0 ? String(lineCount) : undefined}
            badgeColor={isRunning ? "bg-blue-500" : undefined}
          >
            Agent
          </TabBtn>
        </div>
      </div>

      {/* Tab content */}
      {tab === "spec" ? (
        <div ref={containerRef} className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="max-w-4xl px-6 py-4">
            {pr && (
              <a
                href={pr.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-2 mb-4 border border-border rounded-lg hover:border-primary/40 transition-colors"
              >
                <GitPullRequest className={cn(
                  "w-4 h-4",
                  pr.state === "MERGED" ? "text-green-500" :
                  pr.state === "OPEN" ? "text-blue-500" : "text-zinc-400",
                )} />
                <span className="text-sm text-foreground">#{pr.number}</span>
                <span className="text-xs text-muted-foreground truncate flex-1">{pr.title}</span>
                <ExternalLink className="w-3 h-3 text-muted-foreground" />
              </a>
            )}

            {(storyMeta.dependsOn.length > 0 || storyMeta.blocks.length > 0) && (
              <DependencyGraph
                stories={catalog.stories}
                focusId={storyMeta.id}
                onClickNode={openStory}
              />
            )}

            {markdown && (
              <article className="prose prose-sm dark:prose-invert skill-prose">
                <MarkdownContent content={markdown} catalog={catalog} />
              </article>
            )}
          </div>
        </div>
      ) : tab === "edit" ? (
        <SpecEditor storyId={storyMeta.id} markdown={markdown} story={story ?? undefined} />
      ) : (
        <AgentTabContent
          storyId={storyMeta.id}
          session={session}
          outputLines={outputLines}
        />
      )}
    </div>
  );
}

/* -- Spec Editor ---------------------------------------------------------- */

function SpecEditor({ storyId, markdown, story }: { storyId: string; markdown: string; story?: RoadmapStory }) {
  const [draft, setDraft] = useState(markdown);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");

  const baseUrl = useAppStore((s) => {
    const backend = s.backends.find((b) => b.id === s.activeBackendId);
    return backend?.adapter?.baseUrl ?? "";
  });

  const dirty = draft !== markdown;

  // Reset draft when story changes
  useEffect(() => {
    setDraft(markdown);
    setSaveStatus("idle");
  }, [markdown, storyId]);

  const handleSave = useCallback(async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setSaveStatus("idle");

    try {
      // Write updated story back to the b3nd node
      const uri = `mutable://open/rig/roadmap/stories/${storyId}`;
      const updatedStory = { ...(story ?? {}), markdown: draft };
      const res = await fetch(`${baseUrl}/api/v1/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([uri, updatedStory]),
      });
      if (!res.ok) throw new Error(await res.text());
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("error");
    } finally {
      setSaving(false);
    }
  }, [dirty, saving, baseUrl, storyId, story, draft]);

  // Ctrl/Cmd+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

  const canSave = dirty && !!baseUrl && !saving;

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-6 py-2 border-b border-border bg-muted/20 shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Markdown</span>
        <div className="ml-auto flex items-center gap-2">
          {dirty && (
            <span className="text-[10px] text-orange-400">unsaved changes</span>
          )}
          {saveStatus === "saved" && (
            <span className="text-[10px] text-green-400 flex items-center gap-1">
              <Check className="w-3 h-3" /> Saved
            </span>
          )}
          {saveStatus === "error" && (
            <span className="text-[10px] text-red-400">Save failed</span>
          )}
          <button
            onClick={handleSave}
            disabled={!canSave}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors",
              canSave
                ? "bg-primary/15 text-primary hover:bg-primary/25"
                : "text-muted-foreground/40 cursor-not-allowed",
            )}
          >
            <Save className="w-3 h-3" />
            {saving ? "Saving..." : "Save"}
          </button>
          {!baseUrl && (
            <span className="text-[9px] text-muted-foreground/40">no backend</span>
          )}
        </div>
      </div>

      {/* Textarea */}
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="flex-1 w-full resize-none bg-background text-foreground font-mono text-xs leading-5 p-6 outline-none custom-scrollbar"
        spellCheck={false}
      />
    </div>
  );
}

/* -- Tab Button ----------------------------------------------------------- */

function TabBtn({
  active, onClick, children, badge, badgeColor,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  badge?: string;
  badgeColor?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative px-3 py-2 text-xs font-medium transition-colors",
        active
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span className="flex items-center gap-1.5">
        {children}
        {badge && (
          <span className={cn(
            "text-[8px] px-1.5 py-0.5 rounded-full text-white font-mono leading-none",
            badgeColor ?? "bg-zinc-600",
          )}>
            {badge}
          </span>
        )}
      </span>
      {active && (
        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t" />
      )}
    </button>
  );
}

/* -- Agent Tab Content ---------------------------------------------------- */

function AgentTabContent({
  storyId,
  session,
  outputLines,
}: {
  storyId: string;
  session?: import("./useAgentRelay").AgentSession;
  outputLines: string[];
}) {
  const clearOutput = useAgentRelayStore((s) => s.clearOutput);
  const isRunning = session?.status === "running";
  const hasOutput = outputLines.length > 0;

  if (!session && !hasOutput) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-sm text-muted-foreground gap-2 px-6">
        <Loader2 className="w-5 h-5 text-muted-foreground/30" />
        <p>No agent session for this story yet.</p>
        <p className="text-[10px] text-muted-foreground/60">
          Click "Dispatch Agent" to start a Claude Code session.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      {/* Session info bar */}
      {session && (
        <div className="flex items-center gap-3 px-6 py-2 border-b border-border bg-muted/20 shrink-0">
          <SessionStatusIcon session={session} />
          <span className="text-xs font-medium text-foreground">
            {sessionStatusLabel(session)}
          </span>
          <span className="text-[10px] font-mono text-muted-foreground">{session.branch}</span>
          {session.pr && (
            <a
              href={session.pr.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs"
            >
              <GitPullRequest className="w-3.5 h-3.5 text-blue-500" />
              <span className="text-primary hover:underline font-mono">#{session.pr.number}</span>
            </a>
          )}
          <div className="ml-auto flex items-center gap-3">
            <ElapsedTime startedAt={session.startedAt} running={isRunning} />
            {session.exitCode !== undefined && (
              <span className={cn(
                "text-[10px] px-2 py-0.5 rounded-full font-mono",
                session.exitCode === 0
                  ? "bg-green-500/15 text-green-400"
                  : "bg-red-500/15 text-red-400",
              )}>
                exit {session.exitCode}
              </span>
            )}
            {!isRunning && hasOutput && (
              <button
                onClick={() => clearOutput(storyId)}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* Terminal */}
      <TerminalOutput lines={outputLines} running={isRunning} />
    </div>
  );
}

/* -- Agent Launch Bar ---------------------------------------------------- */

function AgentLaunchBar({ storyMeta, story }: { storyMeta: RoadmapStoryMeta; story?: RoadmapStory }) {
  const [copied, setCopied] = useState(false);
  const [includeFeedback, setIncludeFeedback] = useState(false);
  const markLaunched = useRoadmapStore((s) => s.markLaunched);
  const addLogEntry = useAppStore((s) => s.addLogEntry);

  const relayConnected = useAgentRelayStore((s) => s.connected);
  const sessions = useAgentRelayStore((s) => s.sessions);
  const { dispatch, cancel } = useAgentRelayActions();

  const session = sessions.get(storyMeta.id);
  const isRunning = session?.status === "running";
  const hasFinished = session?.status === "complete" || session?.status === "error";

  const hasComments = story?.prComments && story.prComments.length > 0;
  const branchName = `story/${storyMeta.id.toLowerCase()}`;

  const buildPrompt = useCallback(() => {
    const markdown = story?.markdown ?? "";
    let payload = `# ${storyMeta.title}\n\nStory: ${storyMeta.id}\nBranch: \`${branchName}\`\n\n${markdown}`;
    if (includeFeedback && story?.prComments) {
      payload += "\n\n---\n\n## PR Feedback\n\n";
      for (const c of story.prComments) {
        payload += `**${c.author}** (${c.createdAt}):\n${c.body}\n\n`;
      }
    }
    // Check for existing PR (from catalog or live session detection)
    const existingPr = storyMeta.pr ?? session?.pr;

    payload += `\n\n---\n\n## Workflow\n\nYou are in a git worktree already checked out to branch \`${branchName}\`.\nDo NOT run \`git checkout\` — just implement the changes, commit, and push.\n`;
    if (existingPr) {
      payload += `\nThere is already an open PR for this story: **#${existingPr.number}** (${existingPr.url}).\nPush your commits to update the existing PR. Do NOT create a new PR.\n`;
    } else {
      payload += `\nAfter pushing, create a PR: \`gh pr create --title "feat: ${storyMeta.title}" --body "Implements ${storyMeta.id}"\`\n`;
    }
    return payload;
  }, [storyMeta, story, branchName, includeFeedback, session]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(buildPrompt());
      setCopied(true);
      markLaunched(storyMeta.id);
      addLogEntry({
        source: "roadmap",
        message: `Copied agent prompt for ${storyMeta.id}: ${storyMeta.title}`,
        level: "success",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  }, [buildPrompt, storyMeta, markLaunched, addLogEntry]);

  const handleDispatch = useCallback(() => {
    if (useAgentRelayStore.getState().sessions.get(storyMeta.id)?.status === "running") return;
    useAgentRelayStore.getState().clearOutput(storyMeta.id);
    dispatch(storyMeta.id, buildPrompt(), branchName);
    markLaunched(storyMeta.id);
  }, [dispatch, storyMeta.id, buildPrompt, branchName, markLaunched]);

  const handleCancel = useCallback(() => {
    cancel(storyMeta.id);
  }, [cancel, storyMeta.id]);

  return (
    <div className="flex items-center gap-2 mb-3 flex-wrap">
      {/* Primary action */}
      {relayConnected && !isRunning ? (
        <button
          onClick={handleDispatch}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors",
            hasFinished
              ? "bg-green-500/10 text-green-400/80 hover:bg-green-500/20"
              : "bg-green-500/15 text-green-400 hover:bg-green-500/25",
          )}
        >
          <Send className="w-3.5 h-3.5" />
          {hasFinished ? "Re-dispatch" : "Dispatch Agent"}
        </button>
      ) : isRunning ? (
        <button
          onClick={handleCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-orange-500/15 text-orange-400 hover:bg-orange-500/25 transition-colors"
        >
          <XCircle className="w-3.5 h-3.5" />
          Cancel
        </button>
      ) : null}

      {/* Copy */}
      <button
        onClick={handleCopy}
        className={cn(
          "flex items-center gap-1.5 px-2 py-1.5 rounded text-[10px] transition-colors",
          copied
            ? "bg-green-500/15 text-green-400"
            : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
        )}
      >
        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        {copied ? "Copied!" : "Copy Prompt"}
      </button>

      {/* Feedback toggle */}
      {hasComments && (
        <button
          onClick={() => setIncludeFeedback(!includeFeedback)}
          className={cn(
            "flex items-center gap-1 px-2 py-1.5 rounded text-[10px] transition-colors",
            includeFeedback
              ? "bg-purple-500/15 text-purple-400"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
          )}
        >
          <MessageSquare className="w-3 h-3" />
          {includeFeedback ? "with feedback" : "feedback"}
        </button>
      )}

      {/* Branch + relay status pushed right */}
      <div className="ml-auto flex items-center gap-2">
        <span className="text-[10px] font-mono text-muted-foreground">{branchName}</span>
        <span className={cn(
          "flex items-center gap-1 text-[9px]",
          relayConnected ? "text-green-400/60" : "text-muted-foreground/40",
        )}>
          {relayConnected ? <Wifi className="w-2.5 h-2.5" /> : <WifiOff className="w-2.5 h-2.5" />}
          {relayConnected ? "relay" : "offline"}
        </span>
      </div>
    </div>
  );
}

/* -- Dependency Graph Micro-View ----------------------------------------- */

function DependencyGraph({
  stories, focusId, onClickNode,
}: {
  stories: RoadmapStoryMeta[];
  focusId: string;
  onClickNode: (id: string) => void;
}) {
  const { nodes, edges } = useMemo(() => getSubgraph(stories, focusId, 2), [stories, focusId]);

  // Layout: sort by wave into columns
  const columns = useMemo(() => {
    const cols = new Map<number, RoadmapStoryMeta[]>();
    for (const n of nodes) {
      const wave = n.wave ?? 0;
      const list = cols.get(wave) || [];
      list.push(n);
      cols.set(wave, list);
    }
    return [...cols.entries()].sort(([a], [b]) => a - b);
  }, [nodes]);

  // Position map: nodeId -> { col, row }
  const positions = useMemo(() => {
    const map = new Map<string, { col: number; row: number }>();
    columns.forEach(([_wave, colNodes], colIdx) => {
      colNodes.forEach((n, rowIdx) => {
        map.set(n.id, { col: colIdx, row: rowIdx });
      });
    });
    return map;
  }, [columns]);

  if (nodes.length === 0) return null;

  const colWidth = 140;
  const rowHeight = 36;
  const padding = 16;
  const totalCols = columns.length;
  const maxRows = Math.max(...columns.map(([, c]) => c.length), 1);
  const svgWidth = totalCols * colWidth + padding * 2;
  const svgHeight = maxRows * rowHeight + padding * 2;

  return (
    <div className="mb-6 border border-border rounded-lg p-3 overflow-x-auto">
      <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Dependencies</h3>
      <svg width={svgWidth} height={svgHeight} className="block">
        {/* Edges */}
        {edges.map((e, i) => {
          const from = positions.get(e.from);
          const to = positions.get(e.to);
          if (!from || !to) return null;
          const x1 = padding + from.col * colWidth + colWidth - 8;
          const y1 = padding + from.row * rowHeight + rowHeight / 2;
          const x2 = padding + to.col * colWidth + 8;
          const y2 = padding + to.row * rowHeight + rowHeight / 2;
          const mx = (x1 + x2) / 2;
          return (
            <path
              key={i}
              d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
              fill="none"
              stroke="currentColor"
              className="text-border"
              strokeWidth={1.5}
              markerEnd="url(#arrow)"
            />
          );
        })}
        <defs>
          <marker id="arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" className="text-border" />
          </marker>
        </defs>
        {/* Nodes */}
        {columns.map(([_wave, colNodes], colIdx) =>
          colNodes.map((n, rowIdx) => {
            const x = padding + colIdx * colWidth;
            const y = padding + rowIdx * rowHeight;
            const isFocus = n.id === focusId;
            const statusColor =
              n.status === "merged" ? "#22c55e" :
              n.status === "in-progress" ? "#3b82f6" :
              n.status === "review" ? "#a855f7" :
              "#71717a";
            return (
              <g
                key={n.id}
                onClick={() => onClickNode(n.id)}
                className="cursor-pointer"
              >
                <rect
                  x={x + 4}
                  y={y + 4}
                  width={colWidth - 16}
                  height={rowHeight - 10}
                  rx={10}
                  fill={statusColor}
                  fillOpacity={isFocus ? 0.25 : 0.12}
                  stroke={statusColor}
                  strokeWidth={isFocus ? 2 : 1}
                  strokeOpacity={isFocus ? 0.8 : 0.4}
                />
                <text
                  x={x + colWidth / 2 - 4}
                  y={y + rowHeight / 2 + 1}
                  textAnchor="middle"
                  className="text-foreground fill-current"
                  fontSize={9}
                  fontFamily="monospace"
                >
                  {n.id}
                </text>
              </g>
            );
          })
        )}
      </svg>
    </div>
  );
}

/* -- Shared Components --------------------------------------------------- */

function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span className={cn("px-2 py-0.5 text-[10px] rounded-full font-medium text-white", color)}>
      {children}
    </span>
  );
}

/* -- Markdown with Deep Links -------------------------------------------- */

function MarkdownContent({ content, catalog }: { content: string; catalog?: RoadmapCatalog }) {
  const navigate = useNavigate();
  const openStory = useRoadmapStore((s) => s.openStory);

  // Story ID pattern: G{n}-{section}-{nn}
  const storyIdPattern = /\bG\d+-[A-Z]\d+-\d{2}\b/;
  // File path pattern: libs/ or apps/ paths
  const filePathPattern = /^(libs|apps|src)\/[\w\-/.]+\.\w+$/;
  // B3nd URI pattern
  const b3ndUriPattern = /^(mutable|immutable):\/\//;

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: (props: ComponentPropsWithoutRef<"h1">) => {
          const text = extractText(props.children);
          return <h1 id={slugify(text)} {...props} />;
        },
        h2: (props: ComponentPropsWithoutRef<"h2">) => {
          const text = extractText(props.children);
          return <h2 id={slugify(text)} {...props} />;
        },
        h3: (props: ComponentPropsWithoutRef<"h3">) => {
          const text = extractText(props.children);
          return <h3 id={slugify(text)} {...props} />;
        },
        a: ({ href, children, ...rest }: ComponentPropsWithoutRef<"a"> & { href?: string }) => {
          if (href && b3ndUriPattern.test(href)) {
            const explorerPath = href.replace(/^(mutable|immutable):\/\//, "/$1/");
            return (
              <a
                {...rest}
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  navigate(routeForExplorerPath(explorerPath));
                }}
                className="text-primary hover:underline cursor-pointer"
              >
                {children}
              </a>
            );
          }
          return <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>{children}</a>;
        },
        code: ({ className, children, ...rest }: ComponentPropsWithoutRef<"code"> & { className?: string }) => {
          const match = className?.match(/language-(\w+)/);
          if (match) {
            return (
              <SyntaxHighlighter
                style={oneDark}
                language={match[1]}
                PreTag="div"
                customStyle={{ margin: 0, borderRadius: "0.375rem", fontSize: "0.8125rem" }}
              >
                {String(children).replace(/\n$/, "")}
              </SyntaxHighlighter>
            );
          }

          const text = String(children).trim();

          // Inline story ID -> clickable link
          if (catalog && storyIdPattern.test(text)) {
            const storyExists = catalog.stories.some((s) => s.id === text);
            if (storyExists) {
              return (
                <code
                  className="skill-inline-code text-primary cursor-pointer hover:underline"
                  onClick={() => openStory(text)}
                  {...rest}
                >
                  {children}
                </code>
              );
            }
          }

          // Inline file path -> copy on click
          if (filePathPattern.test(text)) {
            return (
              <CopyableCode text={text} {...rest}>
                {children}
              </CopyableCode>
            );
          }

          // B3nd URI inline
          if (b3ndUriPattern.test(text)) {
            const explorerPath = text.replace(/^(mutable|immutable):\/\//, "/$1/");
            return (
              <code
                className="skill-inline-code text-primary cursor-pointer hover:underline"
                onClick={() => navigate(routeForExplorerPath(explorerPath))}
                {...rest}
              >
                {children}
              </code>
            );
          }

          return <code className="skill-inline-code" {...rest}>{children}</code>;
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function CopyableCode({ text, children, ...rest }: { text: string; children: React.ReactNode } & ComponentPropsWithoutRef<"code">) {
  const [copied, setCopied] = useState(false);
  return (
    <code
      className="skill-inline-code cursor-pointer hover:bg-accent/60 relative group"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch { /* */ }
      }}
      {...rest}
    >
      {children}
      {copied && (
        <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[8px] bg-green-500/20 text-green-400 px-1 rounded whitespace-nowrap">
          copied
        </span>
      )}
    </code>
  );
}

function extractText(children: unknown): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(extractText).join("");
  if (children && typeof children === "object" && "props" in children) {
    return extractText((children as { props: { children: unknown } }).props.children);
  }
  return "";
}
