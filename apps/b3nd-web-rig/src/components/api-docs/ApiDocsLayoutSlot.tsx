import { Code2, Loader2, ChevronRight } from "lucide-react";
import { cn } from "../../utils";
import { useApiDocsStore } from "./useApiDocsStore";
import { useApiDocsCatalog } from "./useApiDocsCatalog";
import { useRead } from "../learn/useRead";
import type { ApiLibrary, ApiSymbol } from "./apiDocsTypes";
import { groupByKind, KIND_LABELS } from "./apiDocsTypes";

export function ApiDocsLayoutSlot() {
  useApiDocsCatalog();
  const activeLibrary = useApiDocsStore((s) => s.activeLibrary);
  const catalog = useApiDocsStore((s) => s.catalog);
  const loading = useApiDocsStore((s) => s.catalogLoading);
  const error = useApiDocsStore((s) => s.catalogError);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading API docs...</span>
      </div>
    );
  }

  if (error || !catalog) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-sm text-destructive">{error ?? "No API docs found."}</p>
          <p className="text-xs text-muted-foreground mt-2">Run <code className="bg-muted px-1.5 py-0.5 rounded">make build-api-docs</code> to generate them.</p>
        </div>
      </div>
    );
  }

  if (!activeLibrary) return <OverviewView catalog={catalog} />;

  return <LibraryDetailView libKey={activeLibrary} />;
}

/* -- Overview ------------------------------------------------------------ */

function OverviewView({ catalog }: { catalog: ApiCatalog }) {
  const openLibrary = useApiDocsStore((s) => s.openLibrary);
  const totalSymbols = catalog.libraries.reduce((s, l) => s + l.symbolCount, 0);

  return (
    <div className="max-w-4xl mx-auto px-8 py-10 h-full overflow-y-auto custom-scrollbar">
      <h1 className="text-2xl font-bold text-foreground">API Reference</h1>
      <p className="text-sm text-muted-foreground mt-1 mb-2">
        {catalog.libraries.length} libraries, {totalSymbols} exported symbols.
      </p>
      <p className="text-xs text-muted-foreground mb-8">
        Generated {new Date(catalog.generatedAt).toLocaleDateString()}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {catalog.libraries.map((lib) => (
          <button
            key={lib.key}
            onClick={() => openLibrary(lib.key)}
            className="group text-left p-4 rounded-lg border border-border hover:border-primary/40 hover:bg-accent/30 transition-all"
          >
            <div className="flex items-center gap-2 mb-1">
              <Code2 className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-sm font-semibold text-foreground truncate">{lib.label}</span>
              <ChevronRight className="w-3 h-3 text-muted-foreground/40 ml-auto shrink-0 group-hover:text-primary transition-colors" />
            </div>
            <p className="text-[11px] text-muted-foreground line-clamp-2">{lib.description || "—"}</p>
            <div className="mt-2 text-[10px] text-muted-foreground/60">{lib.symbolCount} exports</div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* -- Library Detail ------------------------------------------------------ */

function LibraryDetailView({ libKey }: { libKey: string }) {
  const uri = `mutable://open/rig/api-docs/libraries/${libKey}`;
  const { data: lib, loading, error } = useRead<ApiLibrary>(uri);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !lib) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-destructive">{error ?? "Library not found."}</p>
      </div>
    );
  }

  const groups = groupByKind(lib.symbols);

  return (
    <div className="max-w-4xl mx-auto px-8 py-10 h-full overflow-y-auto custom-scrollbar">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">{lib.label}</h1>
        {lib.description && (
          <p className="text-sm text-muted-foreground mt-1">{lib.description}</p>
        )}
        <p className="text-xs text-muted-foreground/60 mt-1">
          {lib.entryPoint} &middot; {lib.symbols.length} exports
        </p>
      </div>

      {groups.map(([kind, symbols]) => (
        <section key={kind} className="mb-8">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 border-b border-border pb-1">
            {KIND_LABELS[kind] || kind}
          </h2>
          <div className="space-y-2">
            {symbols.map((sym) => (
              <SymbolCard key={sym.name} symbol={sym} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/* -- Symbol Card --------------------------------------------------------- */

function SymbolCard({ symbol }: { symbol: ApiSymbol }) {
  const kindColors: Record<string, string> = {
    function: "border-l-blue-500",
    class: "border-l-amber-500",
    interface: "border-l-green-500",
    typeAlias: "border-l-purple-500",
    variable: "border-l-cyan-500",
    enum: "border-l-orange-500",
  };

  return (
    <div
      id={`sym-${symbol.name}`}
      className={cn(
        "border border-border rounded-md p-3 border-l-2",
        kindColors[symbol.kind] || "border-l-muted-foreground",
      )}
    >
      <div className="font-mono text-[12px] text-foreground break-all leading-relaxed">
        {symbol.signature}
      </div>
      {symbol.description && (
        <p className="text-[11px] text-muted-foreground mt-1.5">{symbol.description}</p>
      )}
    </div>
  );
}
