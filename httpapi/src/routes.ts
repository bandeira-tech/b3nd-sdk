import { Hono } from "hono";
import { z } from "zod";

import { getAdapter } from "./adapter.ts";
import type { PersistenceAdapter } from "./adapter.ts";
import type {
  ListResponse,
  ReadResponse,
  WriteRequest,
  WriteResponse,
  DeleteResponse,
} from "./types.ts";

const api = new Hono();

// Shared schemas
const InstanceSchema = z.string().min(1).default("default");
const PathSchema = z.string().min(1);
const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const WriteBodySchema = z.object({
  uri: z.string().url(),
  value: z.unknown(),
});

// GET /api/v1/list/:path* - List contents at path with pagination
api.get("/list/:protocol/:domain/:path*", async (c) => {
  try {
    const { protocol, domain, path: rawPath } = c.req.param();
    const fullPath = rawPath ? decodeURIComponent(rawPath) : "/";
    const instance = InstanceSchema.parse(c.req.query("instance"));
    const pagination = PaginationSchema.parse({
      page: c.req.query("page"),
      limit: c.req.query("limit"),
    });

    const adapter: PersistenceAdapter = getAdapter();
    const result: ListResponse = await adapter.listPath(
      protocol,
      domain,
      fullPath,
      { ...pagination },
      instance,
    );

    return c.json(result, 200);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: error.errors }, 400);
    }
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// GET /api/v1/read/:path - Read record at exact path
api.get("/read/:protocol/:domain/:path*", async (c) => {
  try {
    const { protocol, domain, path: rawPath } = c.req.param();
    const fullPath = decodeURIComponent(rawPath || "");
    if (!fullPath.startsWith("/")) fullPath = "/" + fullPath;
    PathSchema.parse(fullPath);
    const instance = InstanceSchema.parse(c.req.query("instance"));

    const adapter: PersistenceAdapter = getAdapter();
    const record: ReadResponse = await adapter.read(
      protocol,
      domain,
      fullPath,
      instance,
    );

    if (!record) {
      return c.json({ error: "Record not found" }, 404);
    }

    return c.json(record, 200);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: error.errors }, 400);
    }
    if (error.message?.includes("not found")) {
      return c.json({ error: "Record not found" }, 404);
    }
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// POST /api/v1/write - Write or update record
api.post("/write", async (c) => {
  try {
    const body = await c.req.json();
    const writeReq: WriteRequest = WriteBodySchema.parse(body);
    const instance = InstanceSchema.parse(c.req.query("instance"));

    const url = new URL(writeReq.uri);
    const protocol = url.protocol.replace(":", "");
    const domain = url.hostname;
    const path = url.pathname;

    const adapter: PersistenceAdapter = getAdapter();
    const result: WriteResponse = await adapter.write(
      protocol,
      domain,
      path,
      writeReq.value,
      instance,
    );

    if (!result.success) {
      return c.json({ error: result.error || "Write failed" }, 400);
    }

    return c.json(result, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: error.errors }, 400);
    }
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// DELETE /api/v1/delete/:path - Delete record at path
api.delete("/delete/:protocol/:domain/:path*", async (c) => {
  try {
    const { protocol, domain, path: rawPath } = c.req.param();
    const fullPath = decodeURIComponent(rawPath || "");
    if (!fullPath.startsWith("/")) fullPath = "/" + fullPath;
    PathSchema.parse(fullPath);
    const instance = InstanceSchema.parse(c.req.query("instance"));

    const adapter: PersistenceAdapter = getAdapter();
    const result: DeleteResponse = await adapter.delete(
      protocol,
      domain,
      fullPath,
      instance,
    );

    if (!result.success) {
      return c.json({ error: result.error || "Delete failed" }, 400);
    }

    return c.json(result, 200);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: error.errors }, 400);
    }
    if (error.message?.includes("not found")) {
      return c.json({ error: "Record not found" }, 404);
    }
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

export { api };
