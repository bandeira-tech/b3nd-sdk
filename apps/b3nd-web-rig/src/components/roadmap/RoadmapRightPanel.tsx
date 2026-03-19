import { useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  FileText, Tag, Link2, BookOpen, Map as MapIcon, X, Loader2,
} from "lucide-react";
import { cn, routeForExplorerPath } from "../../utils";
import { useAppStore } from "../../stores/appStore";
import { useRoadmapStore } from "./useRoadmapStore";
import { useRead } from "../learn/useRead";
import {
  PRIORITY_COLORS, PRIORITY_ORDER, STATUS_COLORS,
  type RoadmapCatalog, type RoadmapStoryMeta,
} from "./roadmapTypes";
import { useRoadmapCommands } from "./useRoadmapCommands";

const CATALOG_URI = "mutable://open/rig/roadmap/catalog";

export function RoadmapRightPanel() {
  const togglePanel = useAppStore((s) => s.togglePanel);
  const activeStory = useRoadmapStore((s) => s.activeStory);
  const activeGroup = useRoadmapStore((s) => s.activeGroup);
  const refreshKey = useRoadmapStore((s) => s.catalogRefreshKey);
  const { data: catalog } = useRead<RoadmapCatalog>(CATALOG_URI, refreshKey);

  if (!catalog) return null;

  const story = activeStory ? catalog.stories.find((s) => s.id === activeStory) : null;

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-border flex items-center justify-between">
        <h2 className="font-semibold text-xs text-muted-foreground uppercase tracking-wide">
          {story ? "Inspector" : "Overview"}
        </h2>
        <button
          onClick={() => togglePanel("right")}
          className="p-1 rounded hover:bg-accent transition-colors"
          title="Close panel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-auto custom-scrollbar">
        {story ? (
          <StoryInspector story={story} catalog={catalog} />
        ) : (
          <GroupOverview catalog={catalog} activeGroup={activeGroup} />
        )}
      </div>
    </div>
  );
}

/* -- Story Inspector ----------------------------------------------------- */

const GROUP_OPTIONS = [
  { value: "apps-possible", label: "Make Apps Possible" },
  { value: "nodes-talk", label: "Nodes Talk" },
  { value: "make-it-pay", label: "Make It Pay" },
  { value: "platform-features", label: "Platform Features" },
  { value: "tell-the-story", label: "Tell the Story" },
];

const STATUS_OPTIONS = ["pending", "in-progress", "review", "merged"] as const;

function StoryInspector({ story, catalog }: { story: RoadmapStoryMeta; catalog: RoadmapCatalog }) {
  const navigate = useNavigate();
  const openStory = useRoadmapStore((s) => s.openStory);
  const bumpRefresh = useRoadmapStore((s) => s.bumpRefresh);
  const { updateStory, connected } = useRoadmapCommands();
  const [updating, setUpdating] = useState<string | null>(null);

  const handleFieldChange = useCallback(async (field: string, value: string) => {
    if (!connected) return;
    setUpdating(field);
    const result = await updateStory(story.id, { [field]: value });
    setUpdating(null);
    if (result.success) bumpRefresh();
  }, [connected, updateStory, story.id, bumpRefresh]);

  // Related stories: same tags
  const relatedStories = useMemo(() => {
    if (story.tags.length === 0) return [];
    return catalog.stories.filter(
      (s) => s.id !== story.id && s.tags.some((t) => story.tags.includes(t)),
    ).slice(0, 8);
  }, [story, catalog.stories]);

  // TASKS excerpt from story data
  const tasksExcerpt = (story as any).tasksExcerpt as string | undefined;

  // LANDSCAPE excerpt from catalog
  const landscapeExcerpt = catalog.landscapeSections?.[story.group];

  return (
    <div className="space-y-0">
      {/* Metadata card */}
      <Section icon={<MapIcon className="w-3 h-3" />} title="Metadata">
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <MetaRow label="Priority">
            {connected ? (
              <EditableSelect
                value={story.priority}
                options={PRIORITY_ORDER.map((p) => ({ value: p, label: p }))}
                onChange={(v) => handleFieldChange("priority", v)}
                loading={updating === "priority"}
                renderValue={(v) => (
                  <span className="flex items-center gap-1">
                    <span className={cn("w-2 h-2 rounded-full", PRIORITY_COLORS[v])} />
                    {v}
                  </span>
                )}
              />
            ) : (
              <span className="flex items-center gap-1">
                <span className={cn("w-2 h-2 rounded-full", PRIORITY_COLORS[story.priority])} />
                {story.priority}
              </span>
            )}
          </MetaRow>
          <MetaRow label="Status">
            {connected ? (
              <EditableSelect
                value={story.status}
                options={STATUS_OPTIONS.map((s) => ({ value: s, label: s }))}
                onChange={(v) => handleFieldChange("status", v)}
                loading={updating === "status"}
                renderValue={(v) => (
                  <span className="flex items-center gap-1">
                    <span className={cn("w-2 h-2 rounded-full", STATUS_COLORS[v])} />
                    {v}
                  </span>
                )}
              />
            ) : (
              <span className="flex items-center gap-1">
                <span className={cn("w-2 h-2 rounded-full", STATUS_COLORS[story.status])} />
                {story.status}
              </span>
            )}
          </MetaRow>
          <MetaRow label="Scope">{story.scope || "—"}</MetaRow>
          <MetaRow label="Wave">{story.wave !== undefined ? `W${story.wave}` : "—"}</MetaRow>
          <MetaRow label="Est. PRs">{story.estimatedPrs}</MetaRow>
          <MetaRow label="Group">
            {connected ? (
              <EditableSelect
                value={story.group}
                options={GROUP_OPTIONS}
                onChange={(v) => handleFieldChange("group", v)}
                loading={updating === "group"}
              />
            ) : (
              GROUP_OPTIONS.find((g) => g.value === story.group)?.label ?? story.group
            )}
          </MetaRow>
        </div>
      </Section>

      {/* Files involved */}
      {story.filesInvolved.length > 0 && (
        <Section icon={<FileText className="w-3 h-3" />} title="Files">
          <div className="space-y-0.5">
            {story.filesInvolved.map((f) => (
              <button
                key={f}
                onClick={() => navigate(routeForExplorerPath(`/mutable/open/${f}`))}
                className="w-full text-left text-[10px] font-mono text-muted-foreground hover:text-primary transition-colors truncate py-0.5"
                title={f}
              >
                {f}
              </button>
            ))}
          </div>
        </Section>
      )}

      {/* Tags */}
      {story.tags.length > 0 && (
        <Section icon={<Tag className="w-3 h-3" />} title="Tags">
          <div className="flex flex-wrap gap-1">
            {story.tags.map((tag) => (
              <span key={tag} className="px-1.5 py-0.5 text-[10px] bg-accent/50 rounded text-muted-foreground">
                {tag}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* Related stories */}
      {relatedStories.length > 0 && (
        <Section icon={<Link2 className="w-3 h-3" />} title="Related">
          {relatedStories.map((s) => (
            <button
              key={s.id}
              onClick={() => openStory(s.id)}
              className="w-full flex items-center gap-1.5 py-0.5 text-left hover:text-primary transition-colors"
            >
              <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", PRIORITY_COLORS[s.priority])} />
              <span className="text-[10px] font-mono text-muted-foreground shrink-0">{s.id}</span>
              <span className="text-[10px] truncate">{s.title}</span>
            </button>
          ))}
        </Section>
      )}

      {/* TASKS.md excerpt */}
      {tasksExcerpt && (
        <Section icon={<BookOpen className="w-3 h-3" />} title="TASKS.md">
          <p className="text-[10px] text-muted-foreground whitespace-pre-wrap leading-relaxed">
            {tasksExcerpt}
          </p>
        </Section>
      )}

      {/* LANDSCAPE.md excerpt */}
      {landscapeExcerpt && (
        <Section icon={<BookOpen className="w-3 h-3" />} title="LANDSCAPE.md">
          <p className="text-[10px] text-muted-foreground whitespace-pre-wrap leading-relaxed">
            {landscapeExcerpt.slice(0, 400)}
          </p>
        </Section>
      )}
    </div>
  );
}

/* -- Group Overview ------------------------------------------------------ */

function GroupOverview({ catalog, activeGroup }: { catalog: RoadmapCatalog; activeGroup: string | null }) {
  const group = activeGroup
    ? catalog.groups.find((g) => g.id === activeGroup)
    : null;

  const landscapeExcerpt = group ? catalog.landscapeSections?.[group.id] : null;

  return (
    <div className="p-3 space-y-4">
      {group ? (
        <>
          <div>
            <h3 className="text-sm font-medium text-foreground">{group.name}</h3>
            <p className="text-[10px] text-muted-foreground mt-1">
              {group.progress.done}/{group.progress.total} done · {group.progress.inProgress} in progress
            </p>
          </div>
          {landscapeExcerpt && (
            <div>
              <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Context</h4>
              <p className="text-[10px] text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {landscapeExcerpt.slice(0, 500)}
              </p>
            </div>
          )}
          {(group.nextUnblocked?.length ?? 0) > 0 && (
            <div>
              <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Ready to Start</h4>
              <div className="flex flex-wrap gap-1">
                {group.nextUnblocked.map((id) => (
                  <span key={id} className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400 font-mono">
                    {id}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div>
            <h3 className="text-sm font-medium text-foreground">Roadmap Overview</h3>
            <p className="text-[10px] text-muted-foreground mt-1">
              {catalog.stats.total} stories · {catalog.stats.byStatus["merged"] || 0} merged · {catalog.stats.byStatus["in-progress"] || 0} in progress
            </p>
          </div>
          {catalog.waves && catalog.waves.length > 0 && (
            <div>
              <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Waves</h4>
              <div className="space-y-1">
                {catalog.waves.map((w) => (
                  <div key={w.wave} className="flex items-center gap-2 text-[10px]">
                    <span className="font-mono text-muted-foreground w-6">W{w.wave}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-accent/30 overflow-hidden">
                      <div
                        className="h-full bg-primary/60 rounded-full"
                        style={{ width: w.total > 0 ? `${(w.done / w.total) * 100}%` : "0%" }}
                      />
                    </div>
                    <span className="text-muted-foreground">{w.done}/{w.total}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {catalog.sharedConcerns && catalog.sharedConcerns.length > 0 && (
            <div>
              <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Shared Concerns</h4>
              <div className="flex flex-wrap gap-1">
                {catalog.sharedConcerns.map((c) => (
                  <span key={c.tag} className="px-1.5 py-0.5 text-[9px] bg-accent/50 rounded text-muted-foreground">
                    {c.tag} ({c.storyIds.length})
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* -- Editable Select ----------------------------------------------------- */

function EditableSelect({
  value, options, onChange, loading, renderValue,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  loading?: boolean;
  renderValue?: (value: string) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  if (loading) {
    return <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />;
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-left hover:text-primary transition-colors cursor-pointer"
        title="Click to edit"
      >
        {renderValue ? renderValue(value) : (options.find((o) => o.value === value)?.label ?? value)}
      </button>
    );
  }

  return (
    <select
      value={value}
      autoFocus
      onChange={(e) => {
        setOpen(false);
        if (e.target.value !== value) onChange(e.target.value);
      }}
      onBlur={() => setOpen(false)}
      className="w-full bg-background border border-border rounded text-[10px] outline-none focus:border-primary/50 py-0.5 px-1"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

/* -- Helpers ------------------------------------------------------------- */

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="p-3 border-b border-border">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-muted-foreground">{icon}</span>
        <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{title}</h4>
      </div>
      {children}
    </div>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-muted-foreground/60 block">{label}</span>
      <span className="text-foreground">{children}</span>
    </div>
  );
}
