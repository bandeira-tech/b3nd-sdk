import type {
  PersistenceValidationFn,
  PersistenceWrite,
} from "../../../persistence/mod.ts";

export const fixtureSchema: Record<string, PersistenceValidationFn<unknown>> = {
  "users://alicedoe": async (
    write: PersistenceWrite<unknown>,
  ): Promise<boolean> => {
    const { value } = write;
    if (typeof value !== "object" || value === null) return false;
    const obj = value as Record<string, unknown>;
    return typeof obj.name === "string" && typeof obj.email === "string";
  },
  "notes://alicedoe": async (
    write: PersistenceWrite<unknown>,
  ): Promise<boolean> => {
    const { value } = write;
    if (typeof value !== "object" || value === null) return false;
    const obj = value as Record<string, unknown>;
    return typeof obj.title === "string" && typeof obj.content === "string";
  },
};

export default fixtureSchema;
