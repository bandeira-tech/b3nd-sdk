/**
 * build-api-docs.ts
 *
 * Extracts API documentation from all libs/ modules using `deno doc --json`,
 * produces a catalog + per-library detail files, and uploads them to b3nd
 * and/or writes static JSON for the web rig.
 *
 * Same dual-output pattern as build-learn-books.ts:
 *   - Static JSON → apps/b3nd-web-rig/public/api-docs/
 *   - B3nd upload → mutable://open/rig/api-docs/*
 *
 * Usage:
 *   DENO_NO_PACKAGE_JSON=1 deno run -A apps/b3nd-web-rig/scripts/build-api-docs.ts
 *
 * Environment variables:
 *   B3ND_NODE_URL            — B3nd HTTP API base (default: http://localhost:9942)
 *   API_DOCS_OUTPUT_STATIC   — Static output dir  (default: apps/b3nd-web-rig/public/api-docs)
 */

// ---------------------------------------------------------------------------
// Types — shared with the web rig React components
// ---------------------------------------------------------------------------

import type {
  ApiCatalog,
  ApiLibrary,
  ApiSymbol,
} from "../src/components/api-docs/apiDocsTypes.ts";

// ---------------------------------------------------------------------------
// deno doc JSON shape (subset we care about)
// ---------------------------------------------------------------------------

interface DocNode {
  name: string;
  kind: string;
  location: { filename: string; line: number; col: number };
  jsDoc?: {
    doc?: string;
    tags?: Array<{ kind: string; name?: string; doc?: string }>;
  };
  declarationKind?: string;
  functionDef?: FunctionDef;
  classDef?: ClassDef;
  interfaceDef?: InterfaceDef;
  typeAliasDef?: TypeAliasDef;
  variableDef?: VariableDef;
  enumDef?: EnumDef;
}

interface FunctionDef {
  params: Array<{ name: string; tsType?: TsType; optional?: boolean }>;
  returnType?: TsType;
  isAsync?: boolean;
  typeParams?: TypeParam[];
}

interface ClassDef {
  constructors?: Array<{ params: Array<{ name: string; tsType?: TsType }> }>;
  methods?: Array<
    { name: string; functionDef?: FunctionDef; accessibility?: string }
  >;
  properties?: Array<{ name: string; tsType?: TsType; readonly?: boolean }>;
  typeParams?: TypeParam[];
  superClass?: string;
  implements?: TsType[];
}

interface InterfaceDef {
  properties?: Array<
    { name: string; tsType?: TsType; readonly?: boolean; optional?: boolean }
  >;
  methods?: Array<
    {
      name: string;
      params?: Array<{ name: string; tsType?: TsType }>;
      returnType?: TsType;
    }
  >;
  typeParams?: TypeParam[];
  extends?: TsType[];
}

interface TypeAliasDef {
  tsType?: TsType;
  typeParams?: TypeParam[];
}

interface VariableDef {
  tsType?: TsType;
  kind?: string;
}

interface EnumDef {
  members?: Array<{ name: string }>;
}

interface TypeParam {
  name: string;
  constraint?: TsType;
  default?: TsType;
}

interface TsType {
  repr?: string;
  kind?: string;
  keyword?: string;
  typeRef?: { typeName: string; typeParams?: TsType[] };
  union?: TsType[];
  intersection?: TsType[];
  array?: TsType;
  literal?: {
    kind: string;
    string?: string;
    number?: number;
    boolean?: boolean;
  };
  fnOrConstructor?: {
    params: Array<{ name: string; tsType?: TsType }>;
    tsType?: TsType;
  };
  typeLiteral?: { properties?: Array<{ name: string; tsType?: TsType }> };
}

// ---------------------------------------------------------------------------
// Type rendering
// ---------------------------------------------------------------------------

function renderType(t: TsType | undefined, depth = 0): string {
  if (!t || depth > 4) return "unknown";
  if (t.keyword) return t.keyword;
  if (t.typeRef) {
    const name = t.typeRef.typeName;
    if (t.typeRef.typeParams?.length) {
      return `${name}<${
        t.typeRef.typeParams.map((p) => renderType(p, depth + 1)).join(", ")
      }>`;
    }
    return name;
  }
  if (t.union) return t.union.map((u) => renderType(u, depth + 1)).join(" | ");
  if (t.intersection) {
    return t.intersection.map((u) => renderType(u, depth + 1)).join(" & ");
  }
  if (t.array) return `${renderType(t.array, depth + 1)}[]`;
  if (t.literal) {
    if (t.literal.kind === "string") return `"${t.literal.string}"`;
    if (t.literal.kind === "number") return String(t.literal.number);
    if (t.literal.kind === "boolean") return String(t.literal.boolean);
  }
  if (t.fnOrConstructor) {
    const params = t.fnOrConstructor.params.map((p) =>
      `${p.name}: ${renderType(p.tsType, depth + 1)}`
    ).join(", ");
    return `(${params}) => ${renderType(t.fnOrConstructor.tsType, depth + 1)}`;
  }
  if (t.repr) return t.repr;
  return "unknown";
}

function renderParams(
  params: Array<{ name: string; tsType?: TsType; optional?: boolean }>,
): string {
  return params
    .map((p) => {
      const opt = p.optional ? "?" : "";
      return `${p.name}${opt}: ${renderType(p.tsType)}`;
    })
    .join(", ");
}

// ---------------------------------------------------------------------------
// Symbol extraction
// ---------------------------------------------------------------------------

function extractSignature(node: DocNode): string {
  switch (node.kind) {
    case "function": {
      const fn = node.functionDef!;
      const async_ = fn.isAsync ? "async " : "";
      const typeParams = fn.typeParams?.length
        ? `<${fn.typeParams.map((t) => t.name).join(", ")}>`
        : "";
      return `${async_}function ${node.name}${typeParams}(${
        renderParams(fn.params)
      }): ${renderType(fn.returnType)}`;
    }
    case "class": {
      const cls = node.classDef!;
      const typeParams = cls.typeParams?.length
        ? `<${cls.typeParams.map((t) => t.name).join(", ")}>`
        : "";
      const ext = cls.superClass ? ` extends ${cls.superClass}` : "";
      return `class ${node.name}${typeParams}${ext}`;
    }
    case "interface": {
      const iface = node.interfaceDef!;
      const typeParams = iface.typeParams?.length
        ? `<${iface.typeParams.map((t) => t.name).join(", ")}>`
        : "";
      const ext = iface.extends?.length
        ? ` extends ${iface.extends.map((t) => renderType(t)).join(", ")}`
        : "";
      return `interface ${node.name}${typeParams}${ext}`;
    }
    case "typeAlias": {
      const ta = node.typeAliasDef!;
      const typeParams = ta.typeParams?.length
        ? `<${ta.typeParams.map((t) => t.name).join(", ")}>`
        : "";
      return `type ${node.name}${typeParams} = ${renderType(ta.tsType)}`;
    }
    case "variable": {
      const v = node.variableDef;
      return `const ${node.name}: ${renderType(v?.tsType)}`;
    }
    case "enum": {
      const members = node.enumDef?.members?.map((m) => m.name).join(", ") ??
        "";
      return `enum ${node.name} { ${members} }`;
    }
    default:
      return node.name;
  }
}

function extractDescription(node: DocNode): string {
  const doc = node.jsDoc?.doc ?? "";
  // First paragraph only
  const firstPara = doc.split(/\n\n/)[0] ?? "";
  return firstPara.replace(/\n/g, " ").trim();
}

function nodeToSymbol(node: DocNode): ApiSymbol {
  return {
    name: node.name,
    kind: node.kind,
    signature: extractSignature(node),
    description: extractDescription(node),
    line: node.location.line,
  };
}

// ---------------------------------------------------------------------------
// Library discovery and processing
// ---------------------------------------------------------------------------

async function discoverLibs(): Promise<string[]> {
  const libs: string[] = [];
  for await (const entry of Deno.readDir("libs")) {
    if (!entry.isDirectory) continue;
    // Check for mod.ts entry point
    try {
      await Deno.stat(`libs/${entry.name}/mod.ts`);
      libs.push(entry.name);
    } catch {
      // No mod.ts, skip
    }
  }
  libs.sort();
  return libs;
}

async function processLib(libName: string): Promise<ApiLibrary | null> {
  const entryPoint = `libs/${libName}/mod.ts`;
  console.log(`  Processing ${entryPoint}...`);

  try {
    const cmd = new Deno.Command("deno", {
      args: ["doc", "--json", entryPoint],
      stdout: "piped",
      stderr: "piped",
      env: { ...Deno.env.toObject(), DENO_NO_PACKAGE_JSON: "1" },
    });

    const { stdout, stderr, success } = await cmd.output();

    if (!success) {
      const errText = new TextDecoder().decode(stderr);
      console.warn(`    Failed: ${errText.slice(0, 200)}`);
      return null;
    }

    const doc: { nodes: DocNode[] } = JSON.parse(
      new TextDecoder().decode(stdout),
    );
    const nodes = doc.nodes ?? [];

    // Extract module-level doc
    const moduleDoc = nodes.find((n) => n.kind === "moduleDoc");
    const moduleDescription =
      moduleDoc?.jsDoc?.doc?.split(/\n\n/)[0]?.replace(/\n/g, " ").trim() ?? "";

    // Extract exported symbols (skip moduleDoc and re-exports without definitions)
    const symbols: ApiSymbol[] = nodes
      .filter((n) =>
        n.kind !== "moduleDoc" && n.declarationKind === "export" && n.name
      )
      .map(nodeToSymbol);

    return {
      key: libName,
      label: libName,
      description: moduleDescription,
      entryPoint,
      symbols,
      generatedAt: Date.now(),
    };
  } catch (e) {
    console.warn(`    Error processing ${libName}: ${e}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// B3nd upload (same pattern as build-learn-books.ts)
// ---------------------------------------------------------------------------

async function uploadToB3nd(
  nodeUrl: string,
  catalog: ApiCatalog,
  libraries: ApiLibrary[],
): Promise<boolean> {
  console.log(`\nUploading to B3nd at ${nodeUrl}...`);

  try {
    // Catalog index
    const catalogRes = await fetch(`${nodeUrl}/api/v1/receive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["mutable://open/rig/api-docs/catalog", {}, catalog]),
    });
    if (!catalogRes.ok) {
      console.warn(`  Catalog upload failed: ${catalogRes.status}`);
      return false;
    }
    console.log("  Catalog uploaded.");

    // Per-library detail (parallel)
    const results = await Promise.allSettled(libraries.map(async (lib) => {
      const uri = `mutable://open/rig/api-docs/libraries/${lib.key}`;
      const res = await fetch(`${nodeUrl}/api/v1/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([uri, {}, lib]),
      });
      if (res.ok) {
        console.log(`  ${lib.key} (${lib.symbols.length} symbols) → ${uri}`);
      } else {
        console.warn(`  ${lib.key} upload failed: ${res.status}`);
      }
    }));
    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length) console.warn(`  ${failures.length} upload(s) failed`);

    return true;
  } catch (e) {
    console.warn(`  B3nd upload failed: ${e}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Static file output
// ---------------------------------------------------------------------------

async function ensureDir(dir: string): Promise<void> {
  try {
    await Deno.mkdir(dir, { recursive: true });
  } catch { /* exists */ }
}

async function writeStaticFiles(
  outputDir: string,
  catalog: ApiCatalog,
  libraries: ApiLibrary[],
): Promise<void> {
  await ensureDir(outputDir);

  // Catalog index
  const catalogJson = JSON.stringify(catalog, null, 2);
  await Deno.writeTextFile(`${outputDir}/catalog.json`, catalogJson);
  console.log(
    `\nStatic catalog written to ${outputDir}/catalog.json (${
      (catalogJson.length / 1024).toFixed(1)
    } KB)`,
  );

  // Per-library detail files (parallel)
  const libsDir = `${outputDir}/libraries`;
  await ensureDir(libsDir);
  await Promise.all(
    libraries.map((lib) =>
      Deno.writeTextFile(
        `${libsDir}/${lib.key}.json`,
        JSON.stringify(lib, null, 2),
      )
    ),
  );
  console.log(`  ${libraries.length} library files written to ${libsDir}/`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== B3nd API Docs Builder ===\n");

  const libNames = await discoverLibs();
  console.log(
    `Found ${libNames.length} libraries:\n  ${libNames.join(", ")}\n`,
  );

  const results = await Promise.all(libNames.map(processLib));
  const libraries = results.filter((lib): lib is ApiLibrary => lib !== null);

  console.log(`\nProcessed ${libraries.length} libraries:`);
  for (const lib of libraries) {
    console.log(`  ${lib.key}: ${lib.symbols.length} symbols`);
  }

  const catalog: ApiCatalog = {
    libraries: libraries.map((lib) => ({
      key: lib.key,
      label: lib.label,
      description: lib.description,
      symbolCount: lib.symbols.length,
      uri: `mutable://open/rig/api-docs/libraries/${lib.key}`,
    })),
    generatedAt: Date.now(),
  };

  // Static output
  const outputDir = Deno.env.get("API_DOCS_OUTPUT_STATIC") ??
    "apps/b3nd-web-rig/public/api-docs";
  await writeStaticFiles(outputDir, catalog, libraries);

  // B3nd upload (skip if B3ND_NODE_URL is explicitly set to empty)
  const nodeUrl = Deno.env.get("B3ND_NODE_URL") ?? "http://localhost:9942";
  if (nodeUrl) {
    await uploadToB3nd(nodeUrl, catalog, libraries);
  } else {
    console.log("\nB3ND_NODE_URL is empty, skipping b3nd upload.");
  }

  console.log("\nDone.");
}

main();
