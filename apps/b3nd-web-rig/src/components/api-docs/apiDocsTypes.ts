// ---------------------------------------------------------------------------
// API Docs types — runtime data loaded from B3nd or static JSON
// ---------------------------------------------------------------------------

export interface ApiSymbol {
  name: string;
  kind: string;
  signature: string;
  description: string;
  line: number;
}

export interface ApiLibrary {
  key: string;
  label: string;
  description: string;
  entryPoint: string;
  symbols: ApiSymbol[];
  generatedAt: number;
}

export interface ApiCatalogEntry {
  key: string;
  label: string;
  description: string;
  symbolCount: number;
  uri: string;
}

export interface ApiCatalog {
  libraries: ApiCatalogEntry[];
  generatedAt: number;
}

// ---------------------------------------------------------------------------
// Grouping helpers
// ---------------------------------------------------------------------------

export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "typeAlias"
  | "variable"
  | "enum"
  | "namespace";

export const KIND_LABELS: Record<string, string> = {
  function: "Functions",
  class: "Classes",
  interface: "Interfaces",
  typeAlias: "Type Aliases",
  variable: "Constants",
  enum: "Enums",
  namespace: "Namespaces",
};

export const KIND_ORDER: string[] = [
  "class",
  "interface",
  "typeAlias",
  "function",
  "variable",
  "enum",
  "namespace",
];

export function groupByKind(symbols: ApiSymbol[]): [string, ApiSymbol[]][] {
  const map = new Map<string, ApiSymbol[]>();
  for (const sym of symbols) {
    const list = map.get(sym.kind) || [];
    list.push(sym);
    map.set(sym.kind, list);
  }
  // Sort groups by KIND_ORDER, then alphabetically within each group
  return KIND_ORDER
    .filter((k) => map.has(k))
    .map((k) =>
      [k, map.get(k)!.sort((a, b) => a.name.localeCompare(b.name))] as [
        string,
        ApiSymbol[],
      ]
    );
}
