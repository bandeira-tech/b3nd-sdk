#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net

// deno:https://deno.land/std@0.208.0/path/_os.ts
var osType = (() => {
  const { Deno: Deno2 } = globalThis;
  if (typeof Deno2?.build?.os === "string") {
    return Deno2.build.os;
  }
  const { navigator } = globalThis;
  if (navigator?.appVersion?.includes?.("Win")) {
    return "windows";
  }
  return "linux";
})();
var isWindows = osType === "windows";

// deno:https://deno.land/std@0.208.0/path/_common/assert_path.ts
function assertPath(path) {
  if (typeof path !== "string") {
    throw new TypeError(`Path must be a string. Received ${JSON.stringify(path)}`);
  }
}

// deno:https://deno.land/std@0.208.0/path/_common/normalize.ts
function assertArg(path) {
  assertPath(path);
  if (path.length === 0) return ".";
}

// deno:https://deno.land/std@0.208.0/path/_common/constants.ts
var CHAR_UPPERCASE_A = 65;
var CHAR_LOWERCASE_A = 97;
var CHAR_UPPERCASE_Z = 90;
var CHAR_LOWERCASE_Z = 122;
var CHAR_DOT = 46;
var CHAR_FORWARD_SLASH = 47;
var CHAR_BACKWARD_SLASH = 92;
var CHAR_COLON = 58;

// deno:https://deno.land/std@0.208.0/path/_common/normalize_string.ts
function normalizeString(path, allowAboveRoot, separator, isPathSeparator2) {
  let res = "";
  let lastSegmentLength = 0;
  let lastSlash = -1;
  let dots = 0;
  let code;
  for (let i = 0, len = path.length; i <= len; ++i) {
    if (i < len) code = path.charCodeAt(i);
    else if (isPathSeparator2(code)) break;
    else code = CHAR_FORWARD_SLASH;
    if (isPathSeparator2(code)) {
      if (lastSlash === i - 1 || dots === 1) {
      } else if (lastSlash !== i - 1 && dots === 2) {
        if (res.length < 2 || lastSegmentLength !== 2 || res.charCodeAt(res.length - 1) !== CHAR_DOT || res.charCodeAt(res.length - 2) !== CHAR_DOT) {
          if (res.length > 2) {
            const lastSlashIndex = res.lastIndexOf(separator);
            if (lastSlashIndex === -1) {
              res = "";
              lastSegmentLength = 0;
            } else {
              res = res.slice(0, lastSlashIndex);
              lastSegmentLength = res.length - 1 - res.lastIndexOf(separator);
            }
            lastSlash = i;
            dots = 0;
            continue;
          } else if (res.length === 2 || res.length === 1) {
            res = "";
            lastSegmentLength = 0;
            lastSlash = i;
            dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          if (res.length > 0) res += `${separator}..`;
          else res = "..";
          lastSegmentLength = 2;
        }
      } else {
        if (res.length > 0) res += separator + path.slice(lastSlash + 1, i);
        else res = path.slice(lastSlash + 1, i);
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i;
      dots = 0;
    } else if (code === CHAR_DOT && dots !== -1) {
      ++dots;
    } else {
      dots = -1;
    }
  }
  return res;
}

// deno:https://deno.land/std@0.208.0/path/posix/_util.ts
function isPosixPathSeparator(code) {
  return code === CHAR_FORWARD_SLASH;
}

// deno:https://deno.land/std@0.208.0/path/posix/normalize.ts
function normalize(path) {
  assertArg(path);
  const isAbsolute4 = isPosixPathSeparator(path.charCodeAt(0));
  const trailingSeparator = isPosixPathSeparator(path.charCodeAt(path.length - 1));
  path = normalizeString(path, !isAbsolute4, "/", isPosixPathSeparator);
  if (path.length === 0 && !isAbsolute4) path = ".";
  if (path.length > 0 && trailingSeparator) path += "/";
  if (isAbsolute4) return `/${path}`;
  return path;
}

// deno:https://deno.land/std@0.208.0/path/posix/join.ts
function join(...paths) {
  if (paths.length === 0) return ".";
  let joined;
  for (let i = 0, len = paths.length; i < len; ++i) {
    const path = paths[i];
    assertPath(path);
    if (path.length > 0) {
      if (!joined) joined = path;
      else joined += `/${path}`;
    }
  }
  if (!joined) return ".";
  return normalize(joined);
}

// deno:https://deno.land/std@0.208.0/assert/assertion_error.ts
var AssertionError = class extends Error {
  name = "AssertionError";
  constructor(message) {
    super(message);
  }
};

// deno:https://deno.land/std@0.208.0/assert/assert.ts
function assert(expr, msg = "") {
  if (!expr) {
    throw new AssertionError(msg);
  }
}

// deno:https://deno.land/std@0.208.0/path/windows/_util.ts
function isPosixPathSeparator2(code) {
  return code === CHAR_FORWARD_SLASH;
}
function isPathSeparator(code) {
  return code === CHAR_FORWARD_SLASH || code === CHAR_BACKWARD_SLASH;
}
function isWindowsDeviceRoot(code) {
  return code >= CHAR_LOWERCASE_A && code <= CHAR_LOWERCASE_Z || code >= CHAR_UPPERCASE_A && code <= CHAR_UPPERCASE_Z;
}

// deno:https://deno.land/std@0.208.0/path/windows/normalize.ts
function normalize2(path) {
  assertArg(path);
  const len = path.length;
  let rootEnd = 0;
  let device;
  let isAbsolute4 = false;
  const code = path.charCodeAt(0);
  if (len > 1) {
    if (isPathSeparator(code)) {
      isAbsolute4 = true;
      if (isPathSeparator(path.charCodeAt(1))) {
        let j = 2;
        let last = j;
        for (; j < len; ++j) {
          if (isPathSeparator(path.charCodeAt(j))) break;
        }
        if (j < len && j !== last) {
          const firstPart = path.slice(last, j);
          last = j;
          for (; j < len; ++j) {
            if (!isPathSeparator(path.charCodeAt(j))) break;
          }
          if (j < len && j !== last) {
            last = j;
            for (; j < len; ++j) {
              if (isPathSeparator(path.charCodeAt(j))) break;
            }
            if (j === len) {
              return `\\\\${firstPart}\\${path.slice(last)}\\`;
            } else if (j !== last) {
              device = `\\\\${firstPart}\\${path.slice(last, j)}`;
              rootEnd = j;
            }
          }
        }
      } else {
        rootEnd = 1;
      }
    } else if (isWindowsDeviceRoot(code)) {
      if (path.charCodeAt(1) === CHAR_COLON) {
        device = path.slice(0, 2);
        rootEnd = 2;
        if (len > 2) {
          if (isPathSeparator(path.charCodeAt(2))) {
            isAbsolute4 = true;
            rootEnd = 3;
          }
        }
      }
    }
  } else if (isPathSeparator(code)) {
    return "\\";
  }
  let tail;
  if (rootEnd < len) {
    tail = normalizeString(path.slice(rootEnd), !isAbsolute4, "\\", isPathSeparator);
  } else {
    tail = "";
  }
  if (tail.length === 0 && !isAbsolute4) tail = ".";
  if (tail.length > 0 && isPathSeparator(path.charCodeAt(len - 1))) {
    tail += "\\";
  }
  if (device === void 0) {
    if (isAbsolute4) {
      if (tail.length > 0) return `\\${tail}`;
      else return "\\";
    } else if (tail.length > 0) {
      return tail;
    } else {
      return "";
    }
  } else if (isAbsolute4) {
    if (tail.length > 0) return `${device}\\${tail}`;
    else return `${device}\\`;
  } else if (tail.length > 0) {
    return device + tail;
  } else {
    return device;
  }
}

// deno:https://deno.land/std@0.208.0/path/windows/join.ts
function join2(...paths) {
  if (paths.length === 0) return ".";
  let joined;
  let firstPart = null;
  for (let i = 0; i < paths.length; ++i) {
    const path = paths[i];
    assertPath(path);
    if (path.length > 0) {
      if (joined === void 0) joined = firstPart = path;
      else joined += `\\${path}`;
    }
  }
  if (joined === void 0) return ".";
  let needsReplace = true;
  let slashCount = 0;
  assert(firstPart !== null);
  if (isPathSeparator(firstPart.charCodeAt(0))) {
    ++slashCount;
    const firstLen = firstPart.length;
    if (firstLen > 1) {
      if (isPathSeparator(firstPart.charCodeAt(1))) {
        ++slashCount;
        if (firstLen > 2) {
          if (isPathSeparator(firstPart.charCodeAt(2))) ++slashCount;
          else {
            needsReplace = false;
          }
        }
      }
    }
  }
  if (needsReplace) {
    for (; slashCount < joined.length; ++slashCount) {
      if (!isPathSeparator(joined.charCodeAt(slashCount))) break;
    }
    if (slashCount >= 2) joined = `\\${joined.slice(slashCount)}`;
  }
  return normalize2(joined);
}

// deno:https://deno.land/std@0.208.0/path/join.ts
function join3(...paths) {
  return isWindows ? join2(...paths) : join(...paths);
}

// deno:https://deno.land/std@0.208.0/path/_common/strip_trailing_separators.ts
function stripTrailingSeparators(segment, isSep) {
  if (segment.length <= 1) {
    return segment;
  }
  let end = segment.length;
  for (let i = segment.length - 1; i > 0; i--) {
    if (isSep(segment.charCodeAt(i))) {
      end = i;
    } else {
      break;
    }
  }
  return segment.slice(0, end);
}

// deno:https://deno.land/std@0.208.0/path/_common/dirname.ts
function assertArg2(path) {
  assertPath(path);
  if (path.length === 0) return ".";
}

// deno:https://deno.land/std@0.208.0/path/windows/dirname.ts
function dirname(path) {
  assertArg2(path);
  const len = path.length;
  let rootEnd = -1;
  let end = -1;
  let matchedSlash = true;
  let offset = 0;
  const code = path.charCodeAt(0);
  if (len > 1) {
    if (isPathSeparator(code)) {
      rootEnd = offset = 1;
      if (isPathSeparator(path.charCodeAt(1))) {
        let j = 2;
        let last = j;
        for (; j < len; ++j) {
          if (isPathSeparator(path.charCodeAt(j))) break;
        }
        if (j < len && j !== last) {
          last = j;
          for (; j < len; ++j) {
            if (!isPathSeparator(path.charCodeAt(j))) break;
          }
          if (j < len && j !== last) {
            last = j;
            for (; j < len; ++j) {
              if (isPathSeparator(path.charCodeAt(j))) break;
            }
            if (j === len) {
              return path;
            }
            if (j !== last) {
              rootEnd = offset = j + 1;
            }
          }
        }
      }
    } else if (isWindowsDeviceRoot(code)) {
      if (path.charCodeAt(1) === CHAR_COLON) {
        rootEnd = offset = 2;
        if (len > 2) {
          if (isPathSeparator(path.charCodeAt(2))) rootEnd = offset = 3;
        }
      }
    }
  } else if (isPathSeparator(code)) {
    return path;
  }
  for (let i = len - 1; i >= offset; --i) {
    if (isPathSeparator(path.charCodeAt(i))) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      matchedSlash = false;
    }
  }
  if (end === -1) {
    if (rootEnd === -1) return ".";
    else end = rootEnd;
  }
  return stripTrailingSeparators(path.slice(0, end), isPosixPathSeparator2);
}

// deno:https://deno.land/std@0.208.0/path/windows/parse.ts
function parse(path) {
  assertPath(path);
  const ret = {
    root: "",
    dir: "",
    base: "",
    ext: "",
    name: ""
  };
  const len = path.length;
  if (len === 0) return ret;
  let rootEnd = 0;
  let code = path.charCodeAt(0);
  if (len > 1) {
    if (isPathSeparator(code)) {
      rootEnd = 1;
      if (isPathSeparator(path.charCodeAt(1))) {
        let j = 2;
        let last = j;
        for (; j < len; ++j) {
          if (isPathSeparator(path.charCodeAt(j))) break;
        }
        if (j < len && j !== last) {
          last = j;
          for (; j < len; ++j) {
            if (!isPathSeparator(path.charCodeAt(j))) break;
          }
          if (j < len && j !== last) {
            last = j;
            for (; j < len; ++j) {
              if (isPathSeparator(path.charCodeAt(j))) break;
            }
            if (j === len) {
              rootEnd = j;
            } else if (j !== last) {
              rootEnd = j + 1;
            }
          }
        }
      }
    } else if (isWindowsDeviceRoot(code)) {
      if (path.charCodeAt(1) === CHAR_COLON) {
        rootEnd = 2;
        if (len > 2) {
          if (isPathSeparator(path.charCodeAt(2))) {
            if (len === 3) {
              ret.root = ret.dir = path;
              ret.base = "\\";
              return ret;
            }
            rootEnd = 3;
          }
        } else {
          ret.root = ret.dir = path;
          return ret;
        }
      }
    }
  } else if (isPathSeparator(code)) {
    ret.root = ret.dir = path;
    ret.base = "\\";
    return ret;
  }
  if (rootEnd > 0) ret.root = path.slice(0, rootEnd);
  let startDot = -1;
  let startPart = rootEnd;
  let end = -1;
  let matchedSlash = true;
  let i = path.length - 1;
  let preDotState = 0;
  for (; i >= rootEnd; --i) {
    code = path.charCodeAt(i);
    if (isPathSeparator(code)) {
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
    if (code === CHAR_DOT) {
      if (startDot === -1) startDot = i;
      else if (preDotState !== 1) preDotState = 1;
    } else if (startDot !== -1) {
      preDotState = -1;
    }
  }
  if (startDot === -1 || end === -1 || // We saw a non-dot character immediately before the dot
  preDotState === 0 || // The (right-most) trimmed path component is exactly '..'
  preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
    if (end !== -1) {
      ret.base = ret.name = path.slice(startPart, end);
    }
  } else {
    ret.name = path.slice(startPart, startDot);
    ret.base = path.slice(startPart, end);
    ret.ext = path.slice(startDot, end);
  }
  ret.base = ret.base || "\\";
  if (startPart > 0 && startPart !== rootEnd) {
    ret.dir = path.slice(0, startPart - 1);
  } else ret.dir = ret.root;
  return ret;
}

// deno:https://deno.land/std@0.208.0/path/posix/dirname.ts
function dirname2(path) {
  assertArg2(path);
  let end = -1;
  let matchedNonSeparator = false;
  for (let i = path.length - 1; i >= 1; --i) {
    if (isPosixPathSeparator(path.charCodeAt(i))) {
      if (matchedNonSeparator) {
        end = i;
        break;
      }
    } else {
      matchedNonSeparator = true;
    }
  }
  if (end === -1) {
    return isPosixPathSeparator(path.charCodeAt(0)) ? "/" : ".";
  }
  return stripTrailingSeparators(path.slice(0, end), isPosixPathSeparator);
}

// deno:https://deno.land/std@0.208.0/path/posix/parse.ts
function parse2(path) {
  assertPath(path);
  const ret = {
    root: "",
    dir: "",
    base: "",
    ext: "",
    name: ""
  };
  if (path.length === 0) return ret;
  const isAbsolute4 = isPosixPathSeparator(path.charCodeAt(0));
  let start;
  if (isAbsolute4) {
    ret.root = "/";
    start = 1;
  } else {
    start = 0;
  }
  let startDot = -1;
  let startPart = 0;
  let end = -1;
  let matchedSlash = true;
  let i = path.length - 1;
  let preDotState = 0;
  for (; i >= start; --i) {
    const code = path.charCodeAt(i);
    if (isPosixPathSeparator(code)) {
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
    if (code === CHAR_DOT) {
      if (startDot === -1) startDot = i;
      else if (preDotState !== 1) preDotState = 1;
    } else if (startDot !== -1) {
      preDotState = -1;
    }
  }
  if (startDot === -1 || end === -1 || // We saw a non-dot character immediately before the dot
  preDotState === 0 || // The (right-most) trimmed path component is exactly '..'
  preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
    if (end !== -1) {
      if (startPart === 0 && isAbsolute4) {
        ret.base = ret.name = path.slice(1, end);
      } else {
        ret.base = ret.name = path.slice(startPart, end);
      }
    }
    ret.base = ret.base || "/";
  } else {
    if (startPart === 0 && isAbsolute4) {
      ret.name = path.slice(1, startDot);
      ret.base = path.slice(1, end);
    } else {
      ret.name = path.slice(startPart, startDot);
      ret.base = path.slice(startPart, end);
    }
    ret.ext = path.slice(startDot, end);
  }
  if (startPart > 0) {
    ret.dir = stripTrailingSeparators(path.slice(0, startPart - 1), isPosixPathSeparator);
  } else if (isAbsolute4) ret.dir = "/";
  return ret;
}

// deno:https://deno.land/std@0.208.0/path/dirname.ts
function dirname3(path) {
  return isWindows ? dirname(path) : dirname2(path);
}

// deno:https://deno.land/std@0.208.0/path/parse.ts
function parse3(path) {
  return isWindows ? parse(path) : parse2(path);
}

// deno:https://deno.land/std@0.208.0/fs/_util.ts
function getFileInfoType(fileInfo) {
  return fileInfo.isFile ? "file" : fileInfo.isDirectory ? "dir" : fileInfo.isSymlink ? "symlink" : void 0;
}

// deno:https://deno.land/std@0.208.0/fs/ensure_dir.ts
async function ensureDir(dir) {
  try {
    await Deno.mkdir(dir, {
      recursive: true
    });
  } catch (err) {
    if (!(err instanceof Deno.errors.AlreadyExists)) {
      throw err;
    }
    const fileInfo = await Deno.lstat(dir);
    if (!fileInfo.isDirectory) {
      throw new Error(`Ensure path exists, expected 'dir', got '${getFileInfoType(fileInfo)}'`);
    }
  }
}

// deno:https://deno.land/std@0.208.0/fs/ensure_symlink.ts
var isWindows2 = Deno.build.os === "windows";

// deno:https://deno.land/std@0.208.0/fs/expand_glob.ts
var isWindows3 = Deno.build.os === "windows";

// deno:https://deno.land/std@0.208.0/fs/move.ts
var EXISTS_ERROR = new Deno.errors.AlreadyExists("dest already exists.");

// deno:https://deno.land/std@0.208.0/fs/copy.ts
var isWindows4 = Deno.build.os === "windows";

// src/config.ts
var CONFIG_DIR = join3(Deno.env.get("HOME") || ".", ".bnd");
var CONFIG_FILE = join3(CONFIG_DIR, "config.toml");
function parseToml(content) {
  const config = {};
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const stringMatch = trimmed.match(/^(\w+)\s*=\s*"([^"]*)"/);
    if (stringMatch) {
      const [, key, value] = stringMatch;
      if (key === "node") config.node = value;
      if (key === "account") config.account = value;
      if (key === "encrypt") config.encrypt = value;
      continue;
    }
    const boolMatch = trimmed.match(/^(\w+)\s*=\s*(true|false)/);
    if (boolMatch) {
      const [, key, value] = boolMatch;
      if (key === "encrypt") config.encrypt = value;
    }
  }
  return config;
}
function serializeToml(config) {
  const lines = [];
  if (config.node) lines.push(`node = "${config.node}"`);
  if (config.account) lines.push(`account = "${config.account}"`);
  if (config.encrypt) lines.push(`encrypt = "${config.encrypt}"`);
  return lines.join("\n") + (lines.length > 0 ? "\n" : "");
}
async function loadConfig() {
  try {
    const content = await Deno.readTextFile(CONFIG_FILE);
    return parseToml(content);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return {};
    }
    throw e;
  }
}
async function saveConfig(config) {
  await ensureDir(CONFIG_DIR);
  const content = serializeToml(config);
  await Deno.writeTextFile(CONFIG_FILE, content);
}
async function updateConfig(key, value) {
  const config = await loadConfig();
  config[key] = value;
  await saveConfig(config);
  console.log(`\u2713 Set ${key} = ${value}`);
  console.log(`  Config saved to ${CONFIG_FILE}`);
}
function getConfigPath() {
  return CONFIG_FILE;
}

// ../sdk/clients/http/mod.ts
var HttpClient = class {
  baseUrl;
  headers;
  timeout;
  constructor(config) {
    this.baseUrl = config.url.replace(/\/$/, "");
    this.headers = config.headers || {};
    this.timeout = config.timeout || 3e4;
  }
  /**
   * Make an HTTP request with timeout
   */
  async request(path, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    try {
      const url = `${this.baseUrl}${path}`;
      const response = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...this.headers,
          ...options.headers
        },
        signal: controller.signal
      });
      return response;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Request timeout after ${this.timeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  /**
   * Parse URI into components
   * Example: "users://alice/profile" -> { protocol: "users", domain: "alice", path: "/profile" }
   */
  parseUri(uri) {
    const url = new URL(uri);
    return {
      protocol: url.protocol.replace(":", ""),
      domain: url.hostname,
      path: url.pathname
    };
  }
  async write(uri, value) {
    try {
      const { protocol, domain, path } = this.parseUri(uri);
      const requestPath = `/api/v1/write/${protocol}/${domain}${path}`;
      const response = await this.request(requestPath, {
        method: "POST",
        body: JSON.stringify({
          value
        })
      });
      const result = await response.json();
      if (!response.ok) {
        return {
          success: false,
          error: `Write failed: ${result.error || response.statusText}`
        };
      }
      return {
        success: true,
        record: result.record
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  async read(uri) {
    try {
      const { protocol, domain, path } = this.parseUri(uri);
      const requestPath = `/api/v1/read/${protocol}/${domain}${path}`;
      const response = await this.request(requestPath, {
        method: "GET"
      });
      if (!response.ok) {
        await response.text();
        if (response.status === 404) {
          return {
            success: false,
            error: "Not found"
          };
        }
        return {
          success: false,
          error: `Read failed: ${response.statusText}`
        };
      }
      const result = await response.json();
      return {
        success: true,
        record: result
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  async list(uri, options) {
    try {
      const { protocol, domain, path } = this.parseUri(uri);
      const params = new URLSearchParams();
      if (options?.page) {
        params.set("page", options.page.toString());
      }
      if (options?.limit) {
        params.set("limit", options.limit.toString());
      }
      if (options?.pattern) {
        params.set("pattern", options.pattern);
      }
      if (options?.sortBy) {
        params.set("sortBy", options.sortBy);
      }
      if (options?.sortOrder) {
        params.set("sortOrder", options.sortOrder);
      }
      const queryString = params.toString();
      const pathPart = path === "/" ? "" : path;
      const requestPath = `/api/v1/list/${protocol}/${domain}${pathPart}${queryString ? `?${queryString}` : ""}`;
      const response = await this.request(requestPath, {
        method: "GET"
      });
      if (!response.ok) {
        return {
          success: true,
          data: [],
          pagination: {
            page: options?.page || 1,
            limit: options?.limit || 50
          }
        };
      }
      const result = await response.json();
      return result;
    } catch (error) {
      return {
        success: true,
        data: [],
        pagination: {
          page: options?.page || 1,
          limit: options?.limit || 50
        }
      };
    }
  }
  async delete(uri) {
    try {
      const { protocol, domain, path } = this.parseUri(uri);
      const requestPath = `/api/v1/delete/${protocol}/${domain}${path}`;
      const response = await this.request(requestPath, {
        method: "DELETE"
      });
      const result = response.ok ? await response.json() : {
        error: await response.text()
      };
      if (!response.ok) {
        return {
          success: false,
          error: `Delete failed: ${result.error}`
        };
      }
      return {
        success: true
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  async health() {
    try {
      const response = await this.request("/api/v1/health", {
        method: "GET"
      });
      if (!response.ok) {
        return {
          status: "unhealthy",
          message: "Health check failed"
        };
      }
      const result = await response.json();
      return result;
    } catch (error) {
      return {
        status: "unhealthy",
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }
  async getSchema() {
    try {
      const response = await this.request("/api/v1/schema", {
        method: "GET"
      });
      if (!response.ok) {
        return [];
      }
      const result = await response.json();
      if (result.schema && Array.isArray(result.schema)) {
        return result.schema;
      }
      return [];
    } catch (error) {
      return [];
    }
  }
  async cleanup() {
  }
};

// src/client.ts
var cachedClient = null;
async function getClient(logger) {
  if (cachedClient) return cachedClient;
  const config = await loadConfig();
  if (!config.node) {
    throw new Error("No node configured. Run: bnd conf node <url>\nExample: bnd conf node https://testnet-evergreen.fire.cat");
  }
  try {
    logger?.info(`Connecting to ${config.node}`);
    cachedClient = new HttpClient({
      url: config.node,
      timeout: 3e4
    });
    logger?.http("GET", `${config.node}/api/v1/health`);
    const health = await cachedClient.health();
    if (health.status === "unhealthy") {
      console.warn("\u26A0 Warning: Node health is unhealthy");
      console.warn(`  Status: ${health.message}`);
    } else {
      logger?.info(`\u2713 Connected (${health.status})`);
    }
    return cachedClient;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.error(`Failed to connect to ${config.node}: ${message}`);
    throw new Error(`Failed to connect to node at ${config.node}: ${message}
Check your node URL: bnd conf node <url>`);
  }
}
async function closeClient(logger) {
  if (cachedClient) {
    await cachedClient.cleanup();
    cachedClient = null;
  }
}

// src/logger.ts
function formatValue(value) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2).split("\n").join("\n    ");
  }
  return String(value);
}
var Logger = class {
  config;
  constructor(config) {
    this.config = config;
  }
  /** Log HTTP request being made */
  http(method, url) {
    if (!this.config.verbose) return;
    console.log(`  \u2192 ${method} ${url}`);
  }
  /** Log important info (connection, results, etc) */
  info(message) {
    if (!this.config.verbose) return;
    console.log(`  \u2139 ${message}`);
  }
  /** Log detailed data structures */
  data(label, value) {
    if (!this.config.verbose) return;
    console.log(`  ${label}:`);
    console.log(`    ${formatValue(value)}`);
  }
  error(message) {
    console.error(`  \u2717 ${message}`);
  }
  section(name) {
    if (!this.config.verbose) return;
    console.log(`
${"\u2500".repeat(60)}`);
    console.log(`  ${name}`);
    console.log(`${"\u2500".repeat(60)}`);
  }
};
function createLogger(verbose) {
  return new Logger({
    verbose
  });
}

// deno:https://deno.land/std@0.208.0/encoding/_util.ts
var encoder = new TextEncoder();
function getTypeName(value) {
  const type = typeof value;
  if (type !== "object") {
    return type;
  } else if (value === null) {
    return "null";
  } else {
    return value?.constructor?.name ?? "object";
  }
}
function validateBinaryLike(source) {
  if (typeof source === "string") {
    return encoder.encode(source);
  } else if (source instanceof Uint8Array) {
    return source;
  } else if (source instanceof ArrayBuffer) {
    return new Uint8Array(source);
  }
  throw new TypeError(`The input must be a Uint8Array, a string, or an ArrayBuffer. Received a value of the type ${getTypeName(source)}.`);
}

// deno:https://deno.land/std@0.208.0/encoding/hex.ts
var hexTable = new TextEncoder().encode("0123456789abcdef");
var textEncoder = new TextEncoder();
var textDecoder = new TextDecoder();
function encodeHex(src) {
  const u8 = validateBinaryLike(src);
  const dst = new Uint8Array(u8.length * 2);
  for (let i = 0; i < dst.length; i++) {
    const v = u8[i];
    dst[i * 2] = hexTable[v >> 4];
    dst[i * 2 + 1] = hexTable[v & 15];
  }
  return textDecoder.decode(dst);
}

// deno:https://jsr.io/@std/encoding/1.0.10/_common16.ts
var alphabet = new TextEncoder().encode("0123456789abcdef");
var rAlphabet = new Uint8Array(128).fill(16);
alphabet.forEach((byte, i) => rAlphabet[byte] = i);
new TextEncoder().encode("ABCDEF").forEach((byte, i) => rAlphabet[byte] = i + 10);
function calcSizeHex(originalSize) {
  return originalSize * 2;
}
function encode(buffer, i, o, alphabet5) {
  for (; i < buffer.length; ++i) {
    const x = buffer[i];
    buffer[o++] = alphabet5[x >> 4];
    buffer[o++] = alphabet5[x & 15];
  }
  return o;
}
function decode(buffer, i, o, alphabet5) {
  if ((buffer.length - o) % 2 === 1) {
    throw new RangeError(`Cannot decode input as hex: Length (${buffer.length - o}) must be divisible by 2`);
  }
  i += 1;
  for (; i < buffer.length; i += 2) {
    buffer[o++] = getByte(buffer[i - 1], alphabet5) << 4 | getByte(buffer[i], alphabet5);
  }
  return o;
}
function getByte(char, alphabet5) {
  const byte = alphabet5[char] ?? 16;
  if (byte === 16) {
    throw new TypeError(`Cannot decode input as hex: Invalid character (${String.fromCharCode(char)})`);
  }
  return byte;
}

// deno:https://jsr.io/@std/encoding/1.0.10/_common_detach.ts
function detach(buffer, maxSize) {
  const originalSize = buffer.length;
  if (buffer.byteOffset) {
    const b = new Uint8Array(buffer.buffer);
    b.set(buffer);
    buffer = b.subarray(0, originalSize);
  }
  buffer = new Uint8Array(buffer.buffer.transfer(maxSize));
  buffer.set(buffer.subarray(0, originalSize), maxSize - originalSize);
  return [
    buffer,
    maxSize - originalSize
  ];
}

// deno:https://jsr.io/@std/encoding/1.0.10/hex.ts
var alphabet2 = new TextEncoder().encode("0123456789abcdef");
var rAlphabet2 = new Uint8Array(128).fill(16);
alphabet2.forEach((byte, i) => rAlphabet2[byte] = i);
new TextEncoder().encode("ABCDEF").forEach((byte, i) => rAlphabet2[byte] = i + 10);
function encodeHex2(src) {
  if (typeof src === "string") {
    src = new TextEncoder().encode(src);
  } else if (src instanceof ArrayBuffer) src = new Uint8Array(src).slice();
  else src = src.slice();
  const [output, i] = detach(src, calcSizeHex(src.length));
  encode(output, i, 0, alphabet2);
  return new TextDecoder().decode(output);
}
function decodeHex(src) {
  const output = new TextEncoder().encode(src);
  return new Uint8Array(output.buffer.transfer(decode(output, 0, 0, rAlphabet2)));
}

// deno:https://jsr.io/@std/encoding/1.0.10/_common64.ts
var padding = "=".charCodeAt(0);
var alphabet3 = {
  base64: new TextEncoder().encode("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"),
  base64url: new TextEncoder().encode("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
};
var rAlphabet3 = {
  base64: new Uint8Array(128).fill(64),
  base64url: new Uint8Array(128).fill(64)
};
alphabet3.base64.forEach((byte, i) => rAlphabet3.base64[byte] = i);
alphabet3.base64url.forEach((byte, i) => rAlphabet3.base64url[byte] = i);
function calcSizeBase64(originalSize) {
  return ((originalSize + 2) / 3 | 0) * 4;
}
function encode2(buffer, i, o, alphabet5, padding3) {
  i += 2;
  for (; i < buffer.length; i += 3) {
    const x = buffer[i - 2] << 16 | buffer[i - 1] << 8 | buffer[i];
    buffer[o++] = alphabet5[x >> 18];
    buffer[o++] = alphabet5[x >> 12 & 63];
    buffer[o++] = alphabet5[x >> 6 & 63];
    buffer[o++] = alphabet5[x & 63];
  }
  switch (i) {
    case buffer.length + 1: {
      const x = buffer[i - 2] << 16;
      buffer[o++] = alphabet5[x >> 18];
      buffer[o++] = alphabet5[x >> 12 & 63];
      buffer[o++] = padding3;
      buffer[o++] = padding3;
      break;
    }
    case buffer.length: {
      const x = buffer[i - 2] << 16 | buffer[i - 1] << 8;
      buffer[o++] = alphabet5[x >> 18];
      buffer[o++] = alphabet5[x >> 12 & 63];
      buffer[o++] = alphabet5[x >> 6 & 63];
      buffer[o++] = padding3;
      break;
    }
  }
  return o;
}
function decode2(buffer, i, o, alphabet5, padding3) {
  for (let x = buffer.length - 2; x < buffer.length; ++x) {
    if (buffer[x] === padding3) {
      for (let y = x + 1; y < buffer.length; ++y) {
        if (buffer[y] !== padding3) {
          throw new TypeError(`Cannot decode input as base64: Invalid character (${String.fromCharCode(buffer[y])})`);
        }
      }
      buffer = buffer.subarray(0, x);
      break;
    }
  }
  if ((buffer.length - o) % 4 === 1) {
    throw new RangeError(`Cannot decode input as base64: Length (${buffer.length - o}), excluding padding, must not have a remainder of 1 when divided by 4`);
  }
  i += 3;
  for (; i < buffer.length; i += 4) {
    const x = getByte2(buffer[i - 3], alphabet5) << 18 | getByte2(buffer[i - 2], alphabet5) << 12 | getByte2(buffer[i - 1], alphabet5) << 6 | getByte2(buffer[i], alphabet5);
    buffer[o++] = x >> 16;
    buffer[o++] = x >> 8 & 255;
    buffer[o++] = x & 255;
  }
  switch (i) {
    case buffer.length + 1: {
      const x = getByte2(buffer[i - 3], alphabet5) << 18 | getByte2(buffer[i - 2], alphabet5) << 12;
      buffer[o++] = x >> 16;
      break;
    }
    case buffer.length: {
      const x = getByte2(buffer[i - 3], alphabet5) << 18 | getByte2(buffer[i - 2], alphabet5) << 12 | getByte2(buffer[i - 1], alphabet5) << 6;
      buffer[o++] = x >> 16;
      buffer[o++] = x >> 8 & 255;
      break;
    }
  }
  return o;
}
function getByte2(char, alphabet5) {
  const byte = alphabet5[char] ?? 64;
  if (byte === 64) {
    throw new TypeError(`Cannot decode input as base64: Invalid character (${String.fromCharCode(char)})`);
  }
  return byte;
}

// deno:https://jsr.io/@std/encoding/1.0.10/base64.ts
var padding2 = "=".charCodeAt(0);
var alphabet4 = new TextEncoder().encode("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/");
var rAlphabet4 = new Uint8Array(128).fill(64);
alphabet4.forEach((byte, i) => rAlphabet4[byte] = i);
function encodeBase64(data) {
  if (typeof data === "string") {
    data = new TextEncoder().encode(data);
  } else if (data instanceof ArrayBuffer) data = new Uint8Array(data).slice();
  else data = data.slice();
  const [output, i] = detach(data, calcSizeBase64(data.length));
  encode2(output, i, 0, alphabet4, padding2);
  return new TextDecoder().decode(output);
}
function decodeBase64(b64) {
  const output = new TextEncoder().encode(b64);
  return new Uint8Array(output.buffer.transfer(decode2(output, 0, 0, rAlphabet4, padding2)));
}

// ../sdk/encrypt/mod.ts
async function generateEncryptionKeyPair() {
  const keyPair = await crypto.subtle.generateKey({
    name: "X25519",
    namedCurve: "X25519"
  }, true, [
    "deriveBits"
  ]);
  const publicKeyBytes = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    publicKeyHex: encodeHex2(new Uint8Array(publicKeyBytes))
  };
}
async function encrypt(data, recipientPublicKeyHex) {
  const ephemeralKeyPair = await generateEncryptionKeyPair();
  const recipientPublicKeyBytes = decodeHex(recipientPublicKeyHex);
  const recipientPublicKey = await crypto.subtle.importKey("raw", recipientPublicKeyBytes, {
    name: "X25519",
    namedCurve: "X25519"
  }, false, []);
  const sharedSecret = await crypto.subtle.deriveBits({
    name: "X25519",
    public: recipientPublicKey
  }, ephemeralKeyPair.privateKey, 256);
  const aesKey = await crypto.subtle.importKey("raw", sharedSecret, {
    name: "AES-GCM",
    length: 256
  }, false, [
    "encrypt"
  ]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encoder2 = new TextEncoder();
  const plaintext = encoder2.encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt({
    name: "AES-GCM",
    iv: nonce
  }, aesKey, plaintext);
  return {
    data: encodeBase64(new Uint8Array(ciphertext)),
    nonce: encodeBase64(nonce),
    ephemeralPublicKey: ephemeralKeyPair.publicKeyHex
  };
}
async function decrypt(encryptedPayload, recipientPrivateKey) {
  if (!encryptedPayload.ephemeralPublicKey) {
    throw new Error("Missing ephemeral public key");
  }
  const ephemeralPublicKeyBytes = decodeHex(encryptedPayload.ephemeralPublicKey);
  const ephemeralPublicKey = await crypto.subtle.importKey("raw", ephemeralPublicKeyBytes, {
    name: "X25519",
    namedCurve: "X25519"
  }, false, []);
  const sharedSecret = await crypto.subtle.deriveBits({
    name: "X25519",
    public: ephemeralPublicKey
  }, recipientPrivateKey, 256);
  const aesKey = await crypto.subtle.importKey("raw", sharedSecret, {
    name: "AES-GCM",
    length: 256
  }, false, [
    "decrypt"
  ]);
  const ciphertext = decodeBase64(encryptedPayload.data);
  const nonce = decodeBase64(encryptedPayload.nonce);
  const plaintext = await crypto.subtle.decrypt({
    name: "AES-GCM",
    iv: nonce
  }, aesKey, ciphertext);
  const decoder = new TextDecoder();
  const json = decoder.decode(plaintext);
  return JSON.parse(json);
}

// src/commands.ts
function parseUri(uri) {
  const match = uri.match(/^([a-z+.-]+):\/\/([^/]+)(.*)$/);
  if (!match) {
    return {
      protocol: "",
      domain: "",
      path: ""
    };
  }
  return {
    protocol: match[1],
    domain: match[2],
    path: match[3]
  };
}
async function pemToCryptoKey(pem, algorithm = "Ed25519") {
  const base64 = pem.split("\n").filter((line) => !line.startsWith("-----")).join("");
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  if (algorithm === "Ed25519") {
    return await crypto.subtle.importKey("pkcs8", bytes, {
      name: "Ed25519",
      namedCurve: "Ed25519"
    }, false, [
      "sign"
    ]);
  } else {
    return await crypto.subtle.importKey("pkcs8", bytes, {
      name: "X25519",
      namedCurve: "X25519"
    }, false, [
      "deriveBits"
    ]);
  }
}
async function loadAccountKey() {
  const config = await loadConfig();
  if (!config.account) {
    throw new Error("No account configured. Run: bnd account create");
  }
  try {
    const content = await Deno.readTextFile(config.account);
    const lines = content.trim().split("\n");
    let publicKeyHex = "";
    let pemLines = [];
    for (const line of lines) {
      if (line.startsWith("PUBLIC_KEY_HEX=")) {
        publicKeyHex = line.substring("PUBLIC_KEY_HEX=".length);
      } else {
        pemLines.push(line);
      }
    }
    const privateKeyPem = pemLines.join("\n");
    if (!publicKeyHex) {
      throw new Error("Public key not found in account key file");
    }
    return {
      privateKeyPem,
      publicKeyHex
    };
  } catch (error) {
    throw new Error(`Failed to load account key from ${config.account}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
async function loadEncryptionKey() {
  const config = await loadConfig();
  if (!config.encrypt) {
    throw new Error("No encryption key configured. Run: bnd encrypt create");
  }
  try {
    const content = await Deno.readTextFile(config.encrypt);
    const lines = content.trim().split("\n");
    let publicKeyHex = "";
    let pemLines = [];
    for (const line of lines) {
      if (line.startsWith("PUBLIC_KEY_HEX=")) {
        publicKeyHex = line.substring("PUBLIC_KEY_HEX=".length);
      } else {
        pemLines.push(line);
      }
    }
    const privateKeyPem = pemLines.join("\n");
    if (!publicKeyHex) {
      throw new Error("Public key not found in encryption key file");
    }
    return {
      privateKeyPem,
      publicKeyHex
    };
  } catch (error) {
    throw new Error(`Failed to load encryption key from ${config.encrypt}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
async function signPayload(privateKeyPem, payload) {
  try {
    const privateKey = await pemToCryptoKey(privateKeyPem, "Ed25519");
    const encoder2 = new TextEncoder();
    const data = encoder2.encode(JSON.stringify(payload));
    const signatureBytes = await crypto.subtle.sign("Ed25519", privateKey, data);
    return encodeHex(new Uint8Array(signatureBytes));
  } catch (error) {
    throw new Error(`Failed to sign payload: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function replaceKeyPlaceholder(uri, publicKey) {
  return uri.replace(/:key/g, publicKey);
}
async function confNode(url) {
  if (!url) {
    throw new Error("Node URL required. Usage: bnd conf node <url>");
  }
  await updateConfig("node", url);
}
async function confAccount(path) {
  if (!path) {
    throw new Error("Account key path required. Usage: bnd conf account <path>");
  }
  await updateConfig("account", path);
}
async function accountCreate(outputPath) {
  try {
    const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify"
    ]);
    const privateKeyBuffer = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
    const publicKeyBuffer = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    const privateKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(privateKeyBuffer)));
    const privateKeyPem = `-----BEGIN PRIVATE KEY-----
${privateKeyBase64.match(/.{1,64}/g)?.join("\n")}
-----END PRIVATE KEY-----`;
    const publicKeyHex = encodeHex(new Uint8Array(publicKeyBuffer));
    const keyPath = outputPath || `${Deno.env.get("HOME")}/.bnd/accounts/default.key`;
    await ensureDir(dirname3(keyPath));
    const content = `${privateKeyPem}
PUBLIC_KEY_HEX=${publicKeyHex}`;
    await Deno.writeTextFile(keyPath, content);
    await Deno.chmod(keyPath, 384);
    await updateConfig("account", keyPath);
    console.log(`\u2713 Account key created`);
    console.log(`  Public key: ${publicKeyHex}`);
    console.log(`  Key file: ${keyPath}`);
    console.log(`  Config updated`);
  } catch (error) {
    throw new Error(`Failed to create account: ${error instanceof Error ? error.message : String(error)}`);
  }
}
async function encryptCreate(outputPath) {
  try {
    const keyPair = await crypto.subtle.generateKey({
      name: "X25519",
      namedCurve: "X25519"
    }, true, [
      "deriveBits"
    ]);
    const privateKeyBuffer = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
    const publicKeyBuffer = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    const privateKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(privateKeyBuffer)));
    const privateKeyPem = `-----BEGIN PRIVATE KEY-----
${privateKeyBase64.match(/.{1,64}/g)?.join("\n")}
-----END PRIVATE KEY-----`;
    const publicKeyHex = encodeHex(new Uint8Array(publicKeyBuffer));
    const keyPath = outputPath || `${Deno.env.get("HOME")}/.bnd/encryption/default.key`;
    await ensureDir(dirname3(keyPath));
    const content = `${privateKeyPem}
PUBLIC_KEY_HEX=${publicKeyHex}`;
    await Deno.writeTextFile(keyPath, content);
    await Deno.chmod(keyPath, 384);
    await updateConfig("encrypt", keyPath);
    console.log(`\u2713 Encryption key created`);
    console.log(`  Public key: ${publicKeyHex}`);
    console.log(`  Key file: ${keyPath}`);
    console.log(`  Config updated`);
  } catch (error) {
    throw new Error(`Failed to create encryption key: ${error instanceof Error ? error.message : String(error)}`);
  }
}
async function confEncrypt(keyPath) {
  if (!keyPath) {
    throw new Error("Encryption key path required. Usage: bnd conf encrypt <path>");
  }
  try {
    await Deno.readTextFile(keyPath);
  } catch {
    throw new Error(`Cannot read encryption key file: ${keyPath}`);
  }
  await updateConfig("encrypt", keyPath);
}
async function write(args, verbose = false) {
  const logger = createLogger(verbose);
  let uri = null;
  let data = null;
  let originalData = null;
  if (args[0] === "-f" && args[1]) {
    const filePath = args[1];
    try {
      const content = await Deno.readTextFile(filePath);
      logger?.info(`Read ${filePath} (${content.length} bytes)`);
      try {
        data = JSON.parse(content);
      } catch {
        data = content;
      }
      uri = parse3(filePath).name;
    } catch (error) {
      throw new Error(`Failed to read file ${filePath}: ${error}`);
    }
  } else if (args[0] && args[1]) {
    uri = args[0];
    try {
      data = JSON.parse(args[1]);
    } catch {
      data = args[1];
    }
  } else {
    throw new Error("Usage: bnd write <uri> <data> OR bnd write -f <filepath>");
  }
  if (!uri) {
    throw new Error("URI is required for write operation");
  }
  originalData = data;
  try {
    const config = await loadConfig();
    const client = await getClient(logger);
    if (uri.includes(":key")) {
      const accountKey = await loadAccountKey();
      uri = replaceKeyPlaceholder(uri, accountKey.publicKeyHex);
      logger?.info(`Replaced :key with public key`);
      const { domain: domain2 } = parseUri(uri);
      if (domain2.includes("accounts")) {
        const config2 = await loadConfig();
        if (config2.encrypt) {
          try {
            const encryptionKey = await loadEncryptionKey();
            const encryptedPayload = await encrypt(data, encryptionKey.publicKeyHex);
            logger?.info(`Encrypted payload`);
            const signature = await signPayload(accountKey.privateKeyPem, encryptedPayload);
            logger?.info(`Signed encrypted payload with account key`);
            data = {
              auth: [
                {
                  pubkey: accountKey.publicKeyHex,
                  signature
                }
              ],
              payload: encryptedPayload
            };
          } catch (error) {
            throw new Error(`Encryption failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        } else {
          const signature = await signPayload(accountKey.privateKeyPem, data);
          logger?.info(`Signed payload with account key`);
          data = {
            auth: [
              {
                pubkey: accountKey.publicKeyHex,
                signature
              }
            ],
            payload: data
          };
        }
      }
    }
    const { protocol, domain, path } = parseUri(uri);
    const endpoint = `${config.node}/api/v1/write/${protocol}/${domain}${path}`;
    logger?.http("POST", endpoint);
    const result = await client.write(uri, data);
    if (result.success) {
      console.log(`\u2713 Write successful`);
      console.log(`  URI: ${uri}`);
      console.log(`  Encrypted: ${config.encrypt ? "yes" : "no"}`);
      console.log(`  Value: ${JSON.stringify(originalData)}`);
      if (result.record?.ts) {
        console.log(`  Timestamp: ${new Date(result.record.ts).toISOString()}`);
      }
    } else {
      throw new Error(result.error || "Write failed with no error message");
    }
  } finally {
    await closeClient(logger);
  }
}
async function read(uri, verbose = false) {
  const logger = createLogger(verbose);
  if (!uri) {
    throw new Error("URI required. Usage: bnd read <uri>");
  }
  try {
    const config = await loadConfig();
    const client = await getClient(logger);
    if (uri.includes(":key")) {
      const accountKey = await loadAccountKey();
      uri = replaceKeyPlaceholder(uri, accountKey.publicKeyHex);
      logger?.info(`Replaced :key with public key`);
    }
    const { protocol, domain, path } = parseUri(uri);
    const endpoint = `${config.node}/api/v1/read/${protocol}/${domain}${path}`;
    logger?.http("GET", endpoint);
    const result = await client.read(uri);
    if (result.success && result.record) {
      console.log(`\u2713 Read successful`);
      console.log(`  URI: ${uri}`);
      console.log(`  Stored Data: ${JSON.stringify(result.record.data, null, 2)}`);
      const config2 = await loadConfig();
      if (config2.encrypt && result.record.data && typeof result.record.data === "object") {
        const data = result.record.data;
        if (data.payload && typeof data.payload === "object") {
          const payload = data.payload;
          if (payload.data && payload.nonce && payload.ephemeralPublicKey) {
            try {
              const encryptionKey = await loadEncryptionKey();
              const encryptedPayload = {
                data: payload.data,
                nonce: payload.nonce,
                ephemeralPublicKey: payload.ephemeralPublicKey
              };
              const privateKey = await pemToCryptoKey(encryptionKey.privateKeyPem, "X25519");
              const decryptedData = await decrypt(encryptedPayload, privateKey);
              console.log(`  Decrypted Payload: ${JSON.stringify(decryptedData)}`);
              logger?.info(`Decrypted payload`);
            } catch (error) {
              logger?.error(`Decryption failed: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        }
      }
      console.log(`  Timestamp: ${new Date(result.record.ts).toISOString()}`);
    } else if (!result.success) {
      throw new Error(result.error || "Read failed");
    } else {
      console.log(`\u2713 Read complete, but no data found at ${uri}`);
    }
  } finally {
    await closeClient(logger);
  }
}
async function list(uri, verbose = false, options) {
  const logger = createLogger(verbose);
  if (!uri) {
    throw new Error("URI required. Usage: bnd list <uri>");
  }
  try {
    const config = await loadConfig();
    const client = await getClient(logger);
    if (uri.includes(":key")) {
      const accountKey = await loadAccountKey();
      uri = replaceKeyPlaceholder(uri, accountKey.publicKeyHex);
      logger?.info(`Replaced :key with public key`);
    }
    const { protocol, domain, path } = parseUri(uri);
    const queryStr = new URLSearchParams(options).toString();
    const endpoint = `${config.node}/api/v1/list/${protocol}/${domain}${path}${queryStr ? `?${queryStr}` : ""}`;
    logger?.http("GET", endpoint);
    const result = await client.list(uri, options);
    if (result.success) {
      console.log(`\u2713 List successful`);
      console.log(`  URI: ${uri}`);
      console.log(`  Total: ${result.pagination.total || result.data.length} items`);
      console.log(`  Page: ${result.pagination.page}/${Math.ceil((result.pagination.total || 0) / (result.pagination.limit || 50))}`);
      console.log("");
      console.log("Items:");
      for (const item of result.data) {
        const itemName = item.name || item.uri || "unknown";
        const itemTime = item.timestamp || item.ts || Date.now();
        console.log(`  - ${itemName} (${new Date(Number(itemTime)).toISOString()})`);
      }
    } else {
      throw new Error(result.error || "List failed");
    }
  } finally {
    await closeClient(logger);
  }
}
async function showConfig() {
  const config = await loadConfig();
  const path = getConfigPath();
  console.log("Current Configuration:");
  console.log(`  Config file: ${path}`);
  console.log(`  Node: ${config.node || "(not set)"}`);
  console.log(`  Account: ${config.account || "(not set)"}`);
  console.log(`  Encryption key: ${config.encrypt || "(not set)"}`);
  if (Object.keys(config).length === 0) {
    console.log("");
    console.log("To configure the CLI, run:");
    console.log("  bnd account create");
    console.log("  bnd conf node <node-url>");
    console.log("  bnd encrypt create");
    console.log("  bnd conf encrypt <path>");
  }
}
function showHelp() {
  console.log(`
b3nd CLI - Development and debugging tool for b3nd nodes

USAGE:
  bnd [options] <command> [arguments]

COMMANDS:
  account create [path]    Generate Ed25519 key pair (PEM format)
  encrypt create [path]    Generate X25519 encryption key pair (PEM format)
  conf node <url>          Set the node URL
  conf account <path>      Set the account key path
  conf encrypt <path>      Set the encryption key path
  write <uri> <data>       Write data to a URI
  write -f <filepath>      Write data from a JSON file
  read <uri>               Read data from a URI
  list <uri>               List items at a URI
  config                   Show current configuration
  server-keys env         Generate server keys and print .env entries
  help                     Show this help message

OPTIONS:
  -v, --verbose            Show detailed operation logs for debugging

SETUP - Single Account:
  bnd account create
  bnd conf node http://localhost:3000
  bnd encrypt create
  bnd conf encrypt ~/.bnd/encryption/default.key

SETUP - Multiple Accounts:
  # Create accounts
  bnd account create ~/.bnd/accounts/alice.key
  bnd account create ~/.bnd/accounts/bob.key

  # Switch accounts
  bnd conf account ~/.bnd/accounts/alice.key

  # Create encryption keys
  bnd encrypt create ~/.bnd/encryption/alice.key
  bnd conf encrypt ~/.bnd/encryption/alice.key

EXAMPLES:
  # Basic operations
  bnd write tmp://some/path "this is a nice little payload"
  bnd read tmp://some/path

  # Account-based writes with automatic signing
  bnd write mutable://accounts/:key/profile '{"name":"Alice"}'
  bnd read mutable://accounts/:key/profile

  # Switch to different account
  bnd conf account ~/.bnd/accounts/bob.key
  bnd write mutable://accounts/:key/profile '{"name":"Bob"}'

DEBUGGING:
  bnd --verbose write test://read-test/foobar "foobar"
  bnd -v read test://read-test/foobar
  bnd config

DOCUMENTATION:
  https://github.com/bandeira-tech/b3nd-sdk
`);
}
async function serverKeysEnv() {
  function bytesToBase64(bytes) {
    return btoa(String.fromCharCode(...bytes));
  }
  function formatPrivateKeyPem(base64) {
    const lines = base64.match(/.{1,64}/g) || [];
    return `-----BEGIN PRIVATE KEY-----
${lines.join("\n")}
-----END PRIVATE KEY-----`;
  }
  async function genEd25519() {
    const kp = await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify"
    ]);
    const priv = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
    const pub = await crypto.subtle.exportKey("raw", kp.publicKey);
    const privateKeyPem = formatPrivateKeyPem(bytesToBase64(new Uint8Array(priv)));
    const publicKeyHex = Array.from(new Uint8Array(pub)).map((b) => b.toString(16).padStart(2, "0")).join("");
    return {
      privateKeyPem,
      publicKeyHex
    };
  }
  async function genX25519() {
    const kp = await crypto.subtle.generateKey({
      name: "X25519",
      namedCurve: "X25519"
    }, true, [
      "deriveBits"
    ]);
    const priv = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
    const pub = await crypto.subtle.exportKey("raw", kp.publicKey);
    const privateKeyPem = formatPrivateKeyPem(bytesToBase64(new Uint8Array(priv)));
    const publicKeyHex = Array.from(new Uint8Array(pub)).map((b) => b.toString(16).padStart(2, "0")).join("");
    return {
      privateKeyPem,
      publicKeyHex
    };
  }
  const id = await genEd25519();
  const enc = await genX25519();
  const envText = `# b3nd Server Keys
# Generated: ${(/* @__PURE__ */ new Date()).toISOString()}

SERVER_IDENTITY_PRIVATE_KEY_PEM="${id.privateKeyPem.replace(/\n/g, "\\n")}"
SERVER_IDENTITY_PUBLIC_KEY_HEX="${id.publicKeyHex}"
SERVER_ENCRYPTION_PRIVATE_KEY_PEM="${enc.privateKeyPem.replace(/\n/g, "\\n")}"
SERVER_ENCRYPTION_PUBLIC_KEY_HEX="${enc.publicKeyHex}"
`;
  console.log(envText);
  try {
    await Deno.writeTextFile(".env.keys", envText);
    console.log("\u2713 Wrote .env.keys (copy values into your .env and delete the file)");
  } catch (_) {
  }
}

// src/main.ts
function parseVerboseFlag(args) {
  const index = args.findIndex((arg) => arg === "-v" || arg === "--verbose");
  if (index !== -1) {
    return {
      args: args.filter((_, i) => i !== index),
      verbose: true
    };
  }
  return {
    args,
    verbose: false
  };
}
async function main() {
  const args = Deno.args;
  if (args.length === 0) {
    showHelp();
    return;
  }
  const { args: cleanArgs, verbose } = parseVerboseFlag(args);
  const command = cleanArgs[0];
  const subcommand = cleanArgs[1];
  try {
    switch (command) {
      case "account": {
        if (!subcommand) {
          throw new Error("Subcommand required. Usage: bnd account <create>");
        }
        if (subcommand === "create") {
          await accountCreate(cleanArgs[2]);
        } else {
          throw new Error(`Unknown account subcommand: ${subcommand}`);
        }
        break;
      }
      case "encrypt": {
        if (!subcommand) {
          throw new Error("Subcommand required. Usage: bnd encrypt <create>");
        }
        if (subcommand === "create") {
          await encryptCreate(cleanArgs[2]);
        } else {
          throw new Error(`Unknown encrypt subcommand: ${subcommand}`);
        }
        break;
      }
      case "conf": {
        if (!subcommand) {
          throw new Error("Subcommand required. Usage: bnd conf <node|account|encrypt> <value>");
        }
        if (subcommand === "node") {
          if (!cleanArgs[2]) {
            throw new Error("Node URL required. Usage: bnd conf node <url>");
          }
          await confNode(cleanArgs[2]);
        } else if (subcommand === "account") {
          if (!cleanArgs[2]) {
            throw new Error("Account key path required. Usage: bnd conf account <path>");
          }
          await confAccount(cleanArgs[2]);
        } else if (subcommand === "encrypt") {
          if (!cleanArgs[2]) {
            throw new Error("Encryption key path required. Usage: bnd conf encrypt <path>");
          }
          await confEncrypt(cleanArgs[2]);
        } else {
          throw new Error(`Unknown conf subcommand: ${subcommand}`);
        }
        break;
      }
      case "write": {
        await write(cleanArgs.slice(1), verbose);
        break;
      }
      case "read": {
        if (!cleanArgs[1]) {
          throw new Error("URI required. Usage: bnd read <uri>");
        }
        await read(cleanArgs[1], verbose);
        break;
      }
      case "list": {
        if (!cleanArgs[1]) {
          throw new Error("URI required. Usage: bnd list <uri>");
        }
        await list(cleanArgs[1], verbose);
        break;
      }
      case "config": {
        await showConfig();
        break;
      }
      case "server-keys": {
        if (subcommand === "env") {
          await serverKeysEnv();
        } else {
          throw new Error("Unknown server-keys subcommand. Usage: bnd server-keys env");
        }
        break;
      }
      case "help":
      case "-h":
      case "--help": {
        showHelp();
        break;
      }
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\u2717 Error: ${message}`);
    Deno.exit(1);
  }
}
main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\u2717 Fatal error: ${message}`);
  Deno.exit(1);
});
