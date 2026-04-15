/** Extension → Content-Type mapping */
const MIME_TYPES: Record<string, string> = {
  // Text
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  mjs: "application/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  // Images
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  avif: "image/avif",
  // Fonts
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
  // Audio/Video
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  webm: "video/webm",
  ogg: "audio/ogg",
  wav: "audio/wav",
  // Other
  wasm: "application/wasm",
  pdf: "application/pdf",
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",
};

/**
 * Get Content-Type from a URI path based on file extension.
 * Falls back to application/octet-stream for unknown extensions.
 */
export function getContentType(uri: string): string {
  const path = uri.split("/").pop() ?? "";
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME_TYPES[ext] || "application/octet-stream";
}

/**
 * Get Cache-Control header value based on the path.
 * Fingerprinted assets (e.g. styles.abc123.css) get immutable caching.
 * Everything else gets a 1-hour cache.
 */
export function getCacheControl(path: string): string {
  const filename = path.split("/").pop() ?? "";
  if (/\.[a-f0-9]{6,}\.(js|css|woff2?)$/i.test(filename)) {
    return "public, max-age=31536000, immutable";
  }
  return "public, max-age=3600";
}
