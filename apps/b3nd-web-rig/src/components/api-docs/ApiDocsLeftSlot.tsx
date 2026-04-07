import { useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, Code2 } from "lucide-react";
import { cn } from "../../utils";
import { useApiDocsStore } from "./useApiDocsStore";
import { useRead } from "../learn/useRead";
import type { ApiCatalog, ApiLibrary } from "./apiDocsTypes";
import { groupByKind, KIND_LABELS } from "./apiDocsTypes";

export function ApiDocsLeftSlot() {
  const activeLibrary = useApiDocsStore((s) => s.activeLibrary);
  const catalog = useApiDocsStore((s) => s.catalog);

  if (!catalog) return null;
  if (!activeLibrary) return <IndexMode catalog={catalog} />;

  const entry = catalog.libraries.find((l) => l.key === activeLibrary);
  if (!entry) return null;

  return <LibraryMode libKey={entry.key} label={entry.label} />;
}

/* -- Index Mode ---------------------------------------------------------- */

function IndexMode({ catalog }: { catalog: ApiCatalog }) {
  const openLibrary = useApiDocsStore((s) => s.openLibrary);

  // Group libraries by prefix: b3nd-client-*, b3nd-*, firecat-*
  const groups = groupLibraries(catalog.libraries);

  const [expanded, setExpanded] = useState<Set<string>>(() =>
    new Set(groups.map(([g]) => g))
  );
  const toggle = (g: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-border bg-card flex items-center gap-2">
        <Code2 className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium">API Reference</span>
      </div>

      <div className="flex-1 overflow-auto custom-scrollbar py-1">
        {groups.map(([groupName, libs]) => (
          <div key={groupName}>
            <button
              onClick={() => toggle(groupName)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
            >
              {expanded.has(groupName)
                ? <ChevronDown className="w-3 h-3 shrink-0" />
                : <ChevronRight className="w-3 h-3 shrink-0" />}
              <span className="font-semibold">{groupName}</span>
              <span className="ml-auto text-[9px] opacity-50">
                {libs.length}
              </span>
            </button>
            {expanded.has(groupName) && libs.map((lib) => (
              <button
                key={lib.key}
                onClick={() => openLibrary(lib.key)}
                className="w-full flex flex-col gap-0.5 pl-8 pr-3 py-2 text-left hover:bg-accent/50 transition-colors"
              >
                <span className="text-xs font-medium text-foreground truncate">
                  {lib.label}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground truncate flex-1">
                    {lib.description || "—"}
                  </span>
                  <span className="text-[9px] text-muted-foreground/60 shrink-0">
                    {lib.symbolCount}
                  </span>
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* -- Library Mode -------------------------------------------------------- */

function LibraryMode({ libKey, label }: { libKey: string; label: string }) {
  const closeLibrary = useApiDocsStore((s) => s.closeLibrary);
  const kindFilter = useApiDocsStore((s) => s.kindFilter);
  const setKindFilter = useApiDocsStore((s) => s.setKindFilter);

  const uri = `mutable://open/rig/api-docs/libraries/${libKey}`;
  const { data: lib } = useRead<ApiLibrary>(uri);

  if (!lib) return null;

  const groups = groupByKind(lib.symbols);

  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-border bg-card">
        <button
          onClick={closeLibrary}
          className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>All Libraries</span>
        </button>
        <div className="px-3 pb-2">
          <span className="text-sm font-medium text-foreground">{label}</span>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {lib.symbols.length} exports
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto custom-scrollbar">
        {groups.map(([kind, symbols]) => {
          const kindLabel = KIND_LABELS[kind] || kind;
          const isFiltered = kindFilter === kind;

          return (
            <div key={kind}>
              <button
                onClick={() => setKindFilter(isFiltered ? null : kind)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wider transition-colors",
                  isFiltered
                    ? "text-primary font-bold"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <ChevronDown className="w-3 h-3 shrink-0" />
                <span className="font-semibold">{kindLabel}</span>
                <span className="ml-auto text-[9px] opacity-50">
                  {symbols.length}
                </span>
              </button>
              {symbols.map((sym) => (
                <button
                  key={sym.name}
                  onClick={() => {
                    const el = document.getElementById(`sym-${sym.name}`);
                    if (el) {
                      el.scrollIntoView({ behavior: "smooth", block: "start" });
                    }
                  }}
                  className="w-full flex items-center gap-2 pl-6 pr-3 py-1.5 text-xs hover:bg-accent/50 transition-colors text-foreground"
                >
                  <KindBadge kind={kind} />
                  <span className="truncate font-mono text-[11px]">
                    {sym.name}
                  </span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* -- Helpers ------------------------------------------------------------- */

function KindBadge({ kind }: { kind: string }) {
  const colors: Record<string, string> = {
    function: "text-blue-500",
    class: "text-amber-500",
    interface: "text-green-500",
    typeAlias: "text-purple-500",
    variable: "text-cyan-500",
    enum: "text-orange-500",
  };
  const letters: Record<string, string> = {
    function: "F",
    class: "C",
    interface: "I",
    typeAlias: "T",
    variable: "V",
    enum: "E",
  };
  return (
    <span
      className={cn(
        "w-4 text-center font-bold text-[10px] shrink-0",
        colors[kind] || "text-muted-foreground",
      )}
    >
      {letters[kind] || "?"}
    </span>
  );
}

interface LibGroup {
  key: string;
  label: string;
  description: string;
  symbolCount: number;
  uri: string;
}

const GROUP_PREFIXES: [string, string][] = [
  ["b3nd-client-", "Clients"],
  ["b3nd-wallet", "Wallet"],
  ["b3nd-server", "Servers"],
  ["firecat-", "Firecat"],
];

function groupLibraries(libs: LibGroup[]): [string, LibGroup[]][] {
  const groups = new Map<string, LibGroup[]>();
  for (const lib of libs) {
    const match = GROUP_PREFIXES.find(([prefix]) => lib.key.startsWith(prefix));
    const group = match ? match[1] : "Core";
    const list = groups.get(group) || [];
    list.push(lib);
    groups.set(group, list);
  }
  // Core first, then alphabetical for the rest
  const sorted = [...groups.keys()].sort((a, b) => {
    if (a === "Core") return -1;
    if (b === "Core") return 1;
    return a.localeCompare(b);
  });
  return sorted.map((g) => [g, groups.get(g)!] as [string, LibGroup[]]);
}
