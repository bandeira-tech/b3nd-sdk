/**
 * @module
 * Converters between b3nd core types and proto wire types.
 *
 * All data fields cross the wire as `bytes`:
 * - JSON-serializable data → UTF-8 encoded JSON bytes
 * - Uint8Array data → raw bytes (flagged with `dataIsBinary`)
 */

import type { Message, ReadResult, ReceiveResult, StatusResult } from "../b3nd-core/types.ts";
import type {
  ReadResultProto,
  ReceiveRequest,
  ReceiveResponse,
  RecordProto,
  StatusResponse,
} from "./schema.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ── Encode (TS → Proto) ────────────────────────────────────────────

/** Encode arbitrary data to proto bytes + binary flag. */
function encodeData(data: unknown): { data: Uint8Array; dataIsBinary: boolean } {
  if (data instanceof Uint8Array) {
    return { data, dataIsBinary: true };
  }
  return { data: encoder.encode(JSON.stringify(data)), dataIsBinary: false };
}

/** Decode proto bytes + binary flag back to TS data. */
function decodeData(data: Uint8Array, isBinary: boolean): unknown {
  if (isBinary) return data;
  const json = decoder.decode(data);
  return json.length > 0 ? JSON.parse(json) : undefined;
}

// ── Message → ReceiveRequest ────────────────────────────────────────

export function messageToReceiveRequest(msg: Message): ReceiveRequest {
  const [uri, values, rawData] = msg;
  const { data, dataIsBinary } = encodeData(rawData);
  return {
    uri,
    valuesJson: JSON.stringify(values),
    data,
    dataIsBinary,
  };
}

export function receiveRequestToMessage(req: ReceiveRequest): Message {
  const values = JSON.parse(req.valuesJson || "{}") as Record<string, number>;
  const data = decodeData(req.data, req.dataIsBinary);
  return [req.uri, values, data];
}

// ── ReceiveResult ↔ ReceiveResponse ─────────────────────────────────

export function receiveResultToResponse(r: ReceiveResult): ReceiveResponse {
  return { accepted: r.accepted, error: r.error ?? "" };
}

export function receiveResponseToResult(r: ReceiveResponse): ReceiveResult {
  return { accepted: r.accepted, ...(r.error ? { error: r.error } : {}) };
}

// ── ReadResult ↔ ReadResultProto ────────────────────────────────────

export function readResultToProto<T>(r: ReadResult<T>): ReadResultProto {
  let record: RecordProto | undefined;
  if (r.success && r.record) {
    const { data, dataIsBinary } = encodeData(r.record.data);
    record = {
      valuesJson: JSON.stringify(r.record.values),
      data,
      dataIsBinary,
    };
  }
  return {
    success: r.success,
    uri: r.uri ?? "",
    error: r.error ?? "",
    record,
  };
}

export function readResultFromProto<T = unknown>(p: ReadResultProto): ReadResult<T> {
  if (!p.success) {
    return {
      success: false,
      ...(p.uri ? { uri: p.uri } : {}),
      ...(p.error ? { error: p.error } : {}),
    };
  }
  const record = p.record
    ? {
        values: JSON.parse(p.record.valuesJson || "{}") as Record<string, number>,
        data: decodeData(p.record.data, p.record.dataIsBinary) as T,
      }
    : undefined;
  return {
    success: true,
    ...(p.uri ? { uri: p.uri } : {}),
    record,
  };
}

// ── StatusResult ↔ StatusResponse ───────────────────────────────────

export function statusResultToResponse(r: StatusResult): StatusResponse {
  return {
    status: r.status,
    message: r.message ?? "",
    schemaJson: r.schema ? JSON.stringify(r.schema) : "",
    detailsJson: r.details ? JSON.stringify(r.details) : "",
  };
}

export function statusResponseToResult(r: StatusResponse): StatusResult {
  return {
    status: r.status as StatusResult["status"],
    ...(r.message ? { message: r.message } : {}),
    ...(r.schemaJson ? { schema: JSON.parse(r.schemaJson) as string[] } : {}),
    ...(r.detailsJson
      ? { details: JSON.parse(r.detailsJson) as Record<string, unknown> }
      : {}),
  };
}
