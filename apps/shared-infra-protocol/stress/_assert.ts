/** Minimal assertion helpers — avoids a JSR dep for the stress tests. */

export class AssertionError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "AssertionError";
  }
}

export function assert(cond: unknown, msg = "assertion failed"): asserts cond {
  if (!cond) throw new AssertionError(msg);
}

export function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new AssertionError(
      `${msg ?? "assertEquals failed"}\n  actual:   ${a}\n  expected: ${e}`,
    );
  }
}
