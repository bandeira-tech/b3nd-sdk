/**
 * Shared query evaluation utilities.
 *
 * Provides in-memory evaluation of WhereClause, projection, and sorting.
 * Used directly by MemoryClient and as a reference for backend-specific
 * translations (Postgres, Mongo).
 *
 * Also provides type guards for the three query modes (portable, native,
 * stored) and the stored query parameter resolution logic.
 */

import type {
  NativeQueryOptions,
  PortableQueryOptions,
  QueryOptions,
  QueryRecord,
  QueryResult,
  ReadResult,
  StoredQueryDefinition,
  StoredQueryOptions,
  WhereClause,
} from "./types.ts";

// ─── Type guards ────────────────────────────────────────────

/** Check if query options use Mode 2 (native passthrough) */
export function isNativeQuery(
  opts: QueryOptions,
): opts is NativeQueryOptions {
  return "native" in opts && opts.native !== undefined;
}

/** Check if query options use Mode 3 (stored query reference) */
export function isStoredQuery(
  opts: QueryOptions,
): opts is StoredQueryOptions {
  return "ref" in opts && typeof (opts as StoredQueryOptions).ref === "string";
}

/** Check if query options use Mode 1 (portable DSL) */
export function isPortableQuery(
  opts: QueryOptions,
): opts is PortableQueryOptions {
  return !isNativeQuery(opts) && !isStoredQuery(opts);
}

// ─── Stored query resolution ────────────────────────────────

/**
 * Recursively substitute $paramName placeholders in a native query template.
 *
 * - String values matching "$paramName" are replaced with the arg value.
 * - Traverses objects and arrays recursively.
 * - Non-string primitives pass through unchanged.
 */
export function substituteParams(
  template: unknown,
  args: Record<string, unknown>,
): unknown {
  if (typeof template === "string") {
    // Exact match: "$city" → args.city (preserves type: number stays number)
    if (template.startsWith("$") && args.hasOwnProperty(template.slice(1))) {
      return args[template.slice(1)];
    }
    // Inline substitution for strings with embedded $params
    return template.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (_match, name) => {
      return args.hasOwnProperty(name) ? String(args[name]) : `$${name}`;
    });
  }
  if (Array.isArray(template)) {
    return template.map((item) => substituteParams(item, args));
  }
  if (template !== null && typeof template === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(template as Record<string, unknown>)) {
      result[key] = substituteParams(value, args);
    }
    return result;
  }
  return template;
}

/**
 * Resolve a stored query: read the definition, validate params, substitute, return NativeQueryOptions.
 *
 * @param opts - The stored query reference
 * @param read - A read function to load the stored query definition from b3nd storage
 * @returns A NativeQueryOptions ready for execution, or an error result
 */
export async function resolveStoredQuery(
  opts: StoredQueryOptions,
  read: <T = unknown>(uri: string) => Promise<ReadResult<T>>,
): Promise<NativeQueryOptions | { success: false; error: string }> {
  const readResult = await read<StoredQueryDefinition>(opts.ref);
  if (!readResult.success || !readResult.record) {
    return { success: false, error: `Stored query not found: ${opts.ref}` };
  }

  const def = readResult.record.data;

  if (!def.prefix || !def.native) {
    return {
      success: false,
      error: `Invalid stored query at ${opts.ref}: missing prefix or native`,
    };
  }

  // Validate required params
  const args = opts.args ?? {};
  if (def.params) {
    for (const [name, spec] of Object.entries(def.params)) {
      if (spec.required && !(name in args)) {
        if (spec.default !== undefined) {
          args[name] = spec.default;
        } else {
          return {
            success: false,
            error: `Missing required parameter: ${name}`,
          };
        }
      }
    }
  }

  // Substitute placeholders in the native template
  const resolvedNative = substituteParams(def.native, args);

  return {
    prefix: def.prefix,
    native: resolvedNative,
  };
}

/**
 * Resolve a dot-separated field path on an object.
 * e.g., getField({ address: { city: "NYC" } }, "address.city") => "NYC"
 */
export function getField(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const part of path.split(".")) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Evaluate a WhereClause against a data value.
 * Returns true if the record matches the clause.
 */
export function evaluateWhere(data: unknown, clause: WhereClause): boolean {
  // Logical combinators
  if ("and" in clause) {
    return clause.and.every((c) => evaluateWhere(data, c));
  }
  if ("or" in clause) {
    return clause.or.some((c) => evaluateWhere(data, c));
  }
  if ("not" in clause) {
    return !evaluateWhere(data, clause.not);
  }

  // Field condition
  const fieldValue = getField(data, clause.field);

  switch (clause.op) {
    case "eq":
      return fieldValue === clause.value;
    case "neq":
      return fieldValue !== clause.value;
    case "gt":
      return (fieldValue as number) > (clause.value as number);
    case "gte":
      return (fieldValue as number) >= (clause.value as number);
    case "lt":
      return (fieldValue as number) < (clause.value as number);
    case "lte":
      return (fieldValue as number) <= (clause.value as number);
    case "in":
      return Array.isArray(clause.value) && clause.value.includes(fieldValue);
    case "contains":
      return typeof fieldValue === "string" &&
        fieldValue.includes(clause.value);
    case "startsWith":
      return typeof fieldValue === "string" &&
        fieldValue.startsWith(clause.value);
    case "endsWith":
      return typeof fieldValue === "string" &&
        fieldValue.endsWith(clause.value);
    case "exists":
      return clause.value ? fieldValue !== undefined : fieldValue === undefined;
    default:
      return false;
  }
}

/**
 * Apply projection (select) to a data object.
 * Returns a new object containing only the specified fields.
 */
export function applySelect(
  data: unknown,
  fields: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    result[field] = getField(data, field);
  }
  return result;
}

/**
 * Compare two values for sorting.
 * Handles numbers, strings, and null/undefined.
 */
function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

/**
 * Execute a portable DSL query against an array of records in memory.
 * This is the reference implementation of query semantics.
 */
export function executeQueryInMemory<T = unknown>(
  records: QueryRecord<unknown>[],
  options: PortableQueryOptions,
): QueryResult<T> {
  let filtered = records;

  // 1. Apply WHERE filter
  if (options.where) {
    filtered = filtered.filter((r) => evaluateWhere(r.data, options.where!));
  }

  const total = filtered.length;

  // 2. Apply ORDER BY
  if (options.orderBy && options.orderBy.length > 0) {
    filtered.sort((a, b) => {
      for (const { field, direction } of options.orderBy!) {
        const aVal = getField(a.data, field);
        const bVal = getField(b.data, field);
        const cmp = compareValues(aVal, bVal);
        if (cmp !== 0) return direction === "desc" ? -cmp : cmp;
      }
      return 0;
    });
  }

  // 3. Apply OFFSET / LIMIT
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 50;
  const paged = filtered.slice(offset, offset + limit);

  // 4. Apply SELECT (projection)
  const result: QueryRecord<T>[] = options.select
    ? paged.map((r) => ({
      uri: r.uri,
      data: applySelect(r.data, options.select!) as unknown as T,
      ts: r.ts,
    }))
    : paged as unknown as QueryRecord<T>[];

  return { success: true, records: result, total };
}
