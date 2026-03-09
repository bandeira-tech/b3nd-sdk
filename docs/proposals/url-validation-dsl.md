# Proposal: URL Validation DSL for Node Schemas

## Problem

Today, defining validation rules for URL programs requires writing JavaScript/TypeScript functions. This works, but has friction:

1. **Readability** — Non-developers (operators, architects, auditors) can't easily review what a node accepts
2. **Portability** — JS functions can't be serialized, shared over the wire, or stored as config
3. **Composition** — The `seq/any/all` combinators are powerful but still require JS wiring
4. **Intent vs. mechanism** — The current code expresses *how* to validate rather than *what* is valid

### Current State (JavaScript)

```typescript
// example-schema.ts — today's approach
const schema: Schema = {
  "mutable://open": () => Promise.resolve({ valid: true }),

  "mutable://accounts": async ({ uri, value }) => {
    const getAccess = createPubkeyBasedAccess();
    const validator = authValidation(getAccess);
    const isValid = await validator({ uri, value });
    return {
      valid: isValid,
      error: isValid ? undefined : "Signature verification failed",
    };
  },

  "immutable://open": async ({ uri, value, read }) => {
    const result = await read(uri);
    return { valid: !result.success };
  },

  "immutable://accounts": async ({ uri, value, read }) => {
    const getAccess = createPubkeyBasedAccess();
    const validator = authValidation(getAccess);
    const isValid = await validator({ uri, value });
    if (isValid) {
      const result = await read(uri);
      return { valid: !result.success, ...(result.success ? { error: "immutable object exists" } : {}) };
    }
    return { valid: isValid, error: "Signature verification failed" };
  },

  "hash://sha256": hashValidator(),

  "link://accounts": async ({ uri, value }) => {
    const getAccess = createPubkeyBasedAccess();
    const validator = authValidation(getAccess);
    const isValid = await validator({ uri, value });
    if (!isValid) return { valid: false, error: "Signature verification failed" };
    const payload = typeof value === "object" && value && "payload" in value
      ? (value as { payload: unknown }).payload : value;
    return validateLinkValue(payload);
  },

  "link://open": async ({ uri, value }) => {
    return validateLinkValue(value);
  },
};
```

That's ~60 lines of TypeScript. The intent is buried in the mechanism.

---

## Option A: Rule-Based Declarative (YAML-like)

The most minimal approach. Each program declares rules as a flat list of checks.
The vocabulary is small and closed — you learn 6-8 keywords and you're done.

```yaml
schema:
  mutable://open:
    accept: true

  mutable://inbox:
    accept: true

  mutable://accounts:
    require: signed
    access: pubkey-owns-path       # signer pubkey must appear in URI path

  immutable://open:
    require: not-exists             # read(uri) must return nothing

  immutable://accounts:
    require: [signed, not-exists]   # all conditions must hold
    access: pubkey-owns-path

  hash://sha256:
    require: content-matches-hash   # value hashes to the URI digest
    require: not-exists             # write-once

  link://accounts:
    require: signed
    access: pubkey-owns-path
    value: valid-uri                # payload must be a valid URI string

  link://open:
    value: valid-uri
```

**Pros**: Very readable, even by non-developers. Fits on one screen. Could be stored as JSON/YAML config.

**Cons**: Limited expressiveness — adding a new rule type means extending the DSL vocabulary. No user-defined logic.

---

## Option B: Pipe / Flow Language

Inspired by the existing `seq/any/all` combinators, but in a dedicated syntax that reads like a sentence describing data flow. The `|>` operator means "then check" and directly mirrors how data moves through validation.

```
schema {

  mutable://open
    |> accept

  mutable://inbox
    |> accept

  mutable://accounts
    |> verify signature using pubkey-from-path
    |> accept

  immutable://open
    |> read @uri                     -- @ references the incoming uri
    |> assert not-found              -- the read must come back empty
    |> accept

  immutable://accounts
    |> verify signature using pubkey-from-path
    |> read @uri
    |> assert not-found
    |> accept

  hash://sha256
    |> hash @value as sha256         -- compute hash of the value
    |> assert @hash == @uri.digest   -- compare to the URI's embedded hash
    |> read @uri
    |> assert not-found
    |> accept

  link://accounts
    |> verify signature using pubkey-from-path
    |> extract payload from @value
    |> assert @payload is valid-uri
    |> accept

  link://open
    |> assert @value is valid-uri
    |> accept
}
```

**Key concepts:**
- `@uri`, `@value` — references to the incoming message tuple `[uri, data]`
- `@uri.digest`, `@uri.path` — dot access to parsed URI components
- `|>` — sequential check (like `seq()`)
- `read @uri` — a first-class operation that queries existing state
- `verify`, `assert`, `extract` — verbs that describe data operations
- `accept` — terminal: validation passes

**Pros**: Reads like English. Makes the data flow visible. Maps 1:1 to the existing combinator model. Intermediate values are named and traceable.

**Cons**: Requires a parser. Slightly more to learn than Option A. Custom logic still needs an escape hatch.

---

## Option C: Pattern + Guard (Reference-Oriented)

Focuses on the idea that validation is about *matching patterns* and *referencing data*. Each rule is a pattern match on the URI, with guards that reference parts of the message or external state.

```
rules {

  -- Public: anyone can write
  match mutable://open/*           -> accept
  match mutable://inbox/*          -> accept

  -- Authenticated: signer must own the path
  match mutable://accounts/{pubkey}/**
    where signed-by {pubkey}       -> accept

  -- Write-once: must not already exist
  match immutable://open/{path}
    where not-exists @uri          -> accept

  -- Write-once + authenticated
  match immutable://accounts/{pubkey}/**
    where signed-by {pubkey}
    where not-exists @uri          -> accept

  -- Content-addressed: hash of value must equal digest in URI
  match hash://sha256/{digest}
    where sha256(@value) == {digest}
    where not-exists @uri          -> accept

  -- Authenticated links: value must be a URI
  match link://accounts/{pubkey}/**
    where signed-by {pubkey}
    where @payload is uri          -> accept

  -- Open links: value must be a URI
  match link://open/**
    where @value is uri            -> accept
}
```

**Key concepts:**
- `match <pattern>` — URI pattern with named captures in `{braces}`
- `{pubkey}`, `{digest}`, `{path}` — captured segments, usable in guards
- `where <condition>` — guards that must all hold (implicit `all`)
- `@uri`, `@value`, `@payload` — references to message data
- `sha256(...)` — built-in functions for common operations
- `->` — the transition from conditions to outcome

**Pros**: Very natural for pattern-matching thinkers. Named captures make the relationship between URI structure and validation explicit. Extensible — new `where` clauses don't break existing rules.

**Cons**: More syntax to learn. The pattern matching metaphor may be less familiar to some audiences.

---

## Option D: Table / Matrix Format

For environments where you want to see all programs and their rules at a glance. Validation as a truth table.

```
program                   | signed | not-exists | content-hash | valid-uri | access
--------------------------|--------|------------|--------------|-----------|----------------
mutable://open            |        |            |              |           |
mutable://inbox           |        |            |              |           |
mutable://accounts        |   x    |            |              |           | pubkey-owns-path
immutable://open          |        |     x      |              |           |
immutable://accounts      |   x    |     x      |              |           | pubkey-owns-path
hash://sha256             |        |     x      |      x       |           |
link://accounts           |   x    |            |              |     x     | pubkey-owns-path
link://open               |        |            |              |     x     |
```

All marked conditions must pass (implicit `all`). Could be stored as CSV or rendered as a UI grid.

**Pros**: Maximum density. Instantly see what each program requires. Perfect for auditing. Could be generated from any of the other DSL options.

**Cons**: Can't express sequencing, branching, or custom logic. Works only for a fixed set of well-known checks. A view, not a language.

---

## Comparison

| Aspect                  | A (Rules/YAML) | B (Pipe/Flow) | C (Pattern/Guard) | D (Table) |
|-------------------------|:--------------:|:-------------:|:-----------------:|:---------:|
| Readable by non-devs    |      +++       |      ++       |        ++         |    +++    |
| Expressiveness          |       +        |      +++      |       +++         |     +     |
| Shows data flow         |       +        |      +++      |        ++         |     -     |
| Shows URI structure     |       +        |       +       |       +++         |     +     |
| Serializable as config  |      +++       |       ++      |        ++         |    +++    |
| Maps to existing code   |       ++       |      +++      |        ++         |     +     |
| Supports custom logic   |       -        |       ++      |        ++         |     -     |
| Learning curve          |      low       |    medium     |      medium       |    low    |

---

## Recommendation

**B (Pipe/Flow) as the primary DSL**, with **D (Table) as a generated view**.

Rationale:
- The `|>` pipe model maps directly to the existing `seq()` combinator — the DSL compiles to what you already have
- The `@uri`, `@value` references make data movement explicit, which is the core mental model of b3nd (everything is `[uri, data]`)
- The table view can be auto-generated from any DSL definition for auditing and documentation
- Option A is too limited for real-world edge cases, Option C adds pattern syntax that overlaps with what URIs already express

### Hybrid Example (B + D)

Define with the pipe DSL:
```
schema {
  mutable://accounts
    |> verify signature using pubkey-from-path
    |> accept
}
```

Auto-generate the audit table:
```
program              | signed | access
---------------------|--------|----------------
mutable://accounts   |   x    | pubkey-owns-path
```

---

## Next Steps

1. Pick an option (or hybrid)
2. Define the formal grammar
3. Build a parser that compiles DSL -> `Schema` (the existing `Record<string, ValidationFn>`)
4. Add a `--schema-file` flag to the node that accepts `.b3nd-schema` files
5. Build the table view generator for auditing

---

## Open Questions

- Should the DSL support `any` (first-match) branching, or only `seq` (all-must-pass)?
- Should custom JS validators be callable from the DSL as named extensions?
- Should the DSL support inline value-shape validation (e.g., `@value has fields [name, email]`)?
- Where do error messages live — inferred from the rule, or explicitly authored?
