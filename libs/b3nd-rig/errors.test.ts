import { assertEquals } from "@std/assert";
import { ErrorCode, Errors } from "../b3nd-core/types.ts";
import {
  classifyError,
  isAuthError,
  isConflictError,
  isNotFoundError,
  isTransientError,
  isValidationError,
} from "./errors.ts";

// ── isTransientError ──

Deno.test("isTransientError - storage error is transient", () => {
  const err = Errors.storageError("disk full");
  assertEquals(isTransientError(err), true);
});

Deno.test("isTransientError - internal error is transient", () => {
  const err = Errors.internal("timeout");
  assertEquals(isTransientError(err), true);
});

Deno.test("isTransientError - auth errors are NOT transient", () => {
  assertEquals(isTransientError(Errors.unauthorized("mutable://x")), false);
  assertEquals(isTransientError(Errors.forbidden("mutable://x")), false);
});

Deno.test("isTransientError - validation errors are NOT transient", () => {
  assertEquals(isTransientError(Errors.invalidUri("bad")), false);
  assertEquals(isTransientError(Errors.invalidSchema("mutable://x")), false);
});

// ── isAuthError ──

Deno.test("isAuthError - unauthorized", () => {
  assertEquals(isAuthError(Errors.unauthorized("mutable://x")), true);
});

Deno.test("isAuthError - forbidden", () => {
  assertEquals(isAuthError(Errors.forbidden("mutable://x")), true);
});

Deno.test("isAuthError - non-auth errors", () => {
  assertEquals(isAuthError(Errors.notFound("mutable://x")), false);
  assertEquals(isAuthError(Errors.storageError("fail")), false);
});

// ── isValidationError ──

Deno.test("isValidationError - invalid URI", () => {
  assertEquals(isValidationError(Errors.invalidUri("bad")), true);
});

Deno.test("isValidationError - invalid schema", () => {
  assertEquals(isValidationError(Errors.invalidSchema("mutable://x")), true);
});

Deno.test("isValidationError - invalid sequence", () => {
  assertEquals(
    isValidationError(Errors.invalidSequence("mutable://x")),
    true,
  );
});

Deno.test("isValidationError - non-validation errors", () => {
  assertEquals(isValidationError(Errors.notFound("mutable://x")), false);
  assertEquals(isValidationError(Errors.storageError("fail")), false);
});

// ── isNotFoundError ──

Deno.test("isNotFoundError - not found", () => {
  assertEquals(isNotFoundError(Errors.notFound("mutable://x")), true);
});

Deno.test("isNotFoundError - other errors", () => {
  assertEquals(isNotFoundError(Errors.storageError("fail")), false);
});

// ── isConflictError ──

Deno.test("isConflictError - conflict", () => {
  assertEquals(isConflictError(Errors.conflict("mutable://x")), true);
});

Deno.test("isConflictError - other errors", () => {
  assertEquals(isConflictError(Errors.notFound("mutable://x")), false);
});

// ── classifyError ──

Deno.test("classifyError - classifies all error types", () => {
  assertEquals(classifyError(Errors.storageError("fail")), "transient");
  assertEquals(classifyError(Errors.internal("fail")), "transient");
  assertEquals(classifyError(Errors.unauthorized("u")), "auth");
  assertEquals(classifyError(Errors.forbidden("u")), "auth");
  assertEquals(classifyError(Errors.invalidUri("u")), "validation");
  assertEquals(classifyError(Errors.invalidSchema("u")), "validation");
  assertEquals(classifyError(Errors.notFound("u")), "not_found");
  assertEquals(classifyError(Errors.conflict("u")), "conflict");
});

Deno.test("classifyError - works with manually constructed errors", () => {
  assertEquals(
    classifyError({
      code: ErrorCode.STORAGE_ERROR,
      message: "connection refused",
    }),
    "transient",
  );
});
