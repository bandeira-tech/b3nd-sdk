const $ = (id) => document.getElementById(id);

function log(msg, kind = "info") {
  const el = $("log");
  const line = document.createElement("div");
  line.className = `line ${kind === "ok" ? "ok" : kind === "err" ? "err" : ""}`;
  const ts = new Date().toLocaleTimeString();
  line.textContent = `${ts} - ${msg}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function setOutput(obj) {
  const el = $("output");
  if (!el) return;
  try {
    el.textContent = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
  } catch (_) {
    el.textContent = String(obj);
  }
}

function normalizeBase(url) {
  return url.replace(/\/$/, "");
}

function normalizeApiBasePath(p) {
  const withLead = p.startsWith("/") ? p : `/${p}`;
  return withLead.replace(/\/$/, "");
}

const state = {
  config: null,
  session: null, // { username, token, expiresIn }
  lastResolvedUri: null,
};

function isConfigured() {
  return !!state.config && typeof state.config.walletUrl === "string" && typeof state.config.apiBasePath === "string" && typeof state.config.backendUrl === "string";
}

function setAuthStatus() {
  const el = $("authStatus");
  if (state.session) {
    el.textContent = `Authenticated as ${state.session.username}`;
  } else {
    el.textContent = "Not authenticated";
  }
}

function requireConfig() {
  if (!isConfigured()) {
    throw new Error("Config not applied. Provide Wallet URL, API Base Path, and Backend URL, then click Apply Config.");
  }
}

function requireAuth() {
  if (!state.session) throw new Error("Not authenticated. Please login or signup.");
}

// Wallet calls
async function walletHealth() {
  requireConfig();
  const { walletUrl, apiBasePath } = state.config;
  const res = await fetch(`${walletUrl}${apiBasePath}/health`);
  if (!res.ok) throw new Error(`Health failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  setOutput(data);
  return data;
}

async function walletServerKeys() {
  requireConfig();
  const { walletUrl, apiBasePath } = state.config;
  const res = await fetch(`${walletUrl}${apiBasePath}/server-keys`);
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || `Server keys failed: ${res.statusText}`);
  setOutput(data);
  return data;
}

async function walletSignup(username, password) {
  requireConfig();
  const { walletUrl, apiBasePath } = state.config;
  const res = await fetch(`${walletUrl}${apiBasePath}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || `Signup failed: ${res.statusText}`);
  const session = { username: data.username, token: data.token, expiresIn: data.expiresIn };
  setOutput(session);
  return session;
}

async function walletLogin(username, password) {
  requireConfig();
  const { walletUrl, apiBasePath } = state.config;
  const res = await fetch(`${walletUrl}${apiBasePath}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || `Login failed: ${res.statusText}`);
  const session = { username: data.username, token: data.token, expiresIn: data.expiresIn };
  setOutput(session);
  return session;
}

async function walletMyPublicKeys() {
  requireConfig();
  requireAuth();
  const { walletUrl, apiBasePath } = state.config;
  const res = await fetch(`${walletUrl}${apiBasePath}/public-keys`, {
    headers: { Authorization: `Bearer ${state.session.token}` },
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || `Public keys failed: ${res.statusText}`);
  setOutput(data);
  return data;
}

async function walletProxyWrite(uri, data, encrypt) {
  requireConfig();
  requireAuth();
  const { walletUrl, apiBasePath } = state.config;
  const res = await fetch(`${walletUrl}${apiBasePath}/proxy/write`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.session.token}`,
    },
    body: JSON.stringify({ uri, data, encrypt: !!encrypt }),
  });
  const resp = await res.json();
  if (!res.ok || !resp.success) throw new Error(resp.error || `Proxy write failed: ${res.statusText}`);
  setOutput(resp);
  return resp;
}

// Backend read
async function backendRead(uri) {
  requireConfig();
  const { backendUrl, backendInstance } = state.config;
  const u = new URL(uri);
  const protocol = u.protocol.replace(":", "");
  const domain = u.hostname;
  const path = u.pathname || "/";
  const instance = backendInstance && backendInstance.length > 0 ? backendInstance : "default";
  const readPath = `${backendUrl.replace(/\/$/, "")}/api/v1/read/${instance}/${protocol}/${domain}${path}`;
  const res = await fetch(readPath);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Backend read failed: ${res.status} ${res.statusText} ${txt || ""}`.trim());
  }
  const data = await res.json();
  setOutput(data);
  return data;
}

// Navigation
function setActiveSection(id) {
  document.querySelectorAll('.nav-item').forEach((btn) => {
    if (btn.dataset.section === id) btn.classList.add('active'); else btn.classList.remove('active');
  });
  document.querySelectorAll('.section').forEach((sec) => {
    if (sec.id === id) sec.classList.add('visible'); else sec.classList.remove('visible');
  });
}

document.addEventListener('click', (e) => {
  const t = e.target;
  if (t && t.classList && t.classList.contains('nav-item')) {
    const id = t.getAttribute('data-section');
    if (id) {
      setActiveSection(id);
    }
  }
});

// Wire UI
function applyConfigFromInputs() {
  const walletUrl = $("walletUrl").value.trim();
  const apiBasePath = $("apiBasePath").value.trim();
  const backendUrl = $("backendUrl").value.trim();
  const backendInstance = $("backendInstance").value.trim();
  if (!walletUrl || !apiBasePath || !backendUrl) {
    throw new Error("Please provide Wallet Server URL, API Base Path, and Backend URL.");
  }
  state.config = {
    walletUrl: normalizeBase(walletUrl),
    apiBasePath: normalizeApiBasePath(apiBasePath),
    backendUrl: normalizeBase(backendUrl),
    backendInstance,
  };
}

function saveConfig() {
  if (!state.config) throw new Error("No config to save. Apply it first.");
  localStorage.setItem("b3nd-writer-config", JSON.stringify(state.config));
}

function loadConfig() {
  const raw = localStorage.getItem("b3nd-writer-config");
  if (!raw) throw new Error("No saved config.");
  const cfg = JSON.parse(raw);
  if (!cfg.walletUrl || !cfg.apiBasePath || !cfg.backendUrl) throw new Error("Saved config is incomplete.");
  $("walletUrl").value = cfg.walletUrl;
  $("apiBasePath").value = cfg.apiBasePath;
  $("backendUrl").value = cfg.backendUrl;
  $("backendInstance").value = cfg.backendInstance || "";
}

function clearConfig() {
  localStorage.removeItem("b3nd-writer-config");
}

// Events
$("applyConfig").addEventListener("click", () => {
  try {
    applyConfigFromInputs();
    log(`Config applied: wallet=${state.config.walletUrl} base=${state.config.apiBasePath} backend=${state.config.backendUrl}`, "ok");
  } catch (e) {
    log(e.message || String(e), "err");
  }
});

$("saveConfig").addEventListener("click", () => {
  try { saveConfig(); log("Config saved", "ok"); } catch (e) { log(e.message || String(e), "err"); }
});
$("loadConfig").addEventListener("click", () => {
  try { loadConfig(); log("Config loaded into inputs", "ok"); } catch (e) { log(e.message || String(e), "err"); }
});
$("clearConfig").addEventListener("click", () => {
  try { clearConfig(); log("Saved config cleared", "ok"); } catch (e) { log(e.message || String(e), "err"); }
});

$("signupBtn").addEventListener("click", async () => {
  const username = $("username").value.trim();
  const password = $("password").value.trim();
  if (!username || !password) return log("Provide username and password", "err");
  try {
    const sess = await walletSignup(username, password);
    state.session = sess;
    setAuthStatus();
    log(`Signup ok. Expires in ${sess.expiresIn}s`, "ok");
  } catch (e) {
    log(e.message || String(e), "err");
  }
});

$("loginBtn").addEventListener("click", async () => {
  const username = $("username").value.trim();
  const password = $("password").value.trim();
  if (!username || !password) return log("Provide username and password", "err");
  try {
    const sess = await walletLogin(username, password);
    state.session = sess;
    setAuthStatus();
    log(`Login ok. Expires in ${sess.expiresIn}s`, "ok");
  } catch (e) {
    log(e.message || String(e), "err");
  }
});

$("logoutBtn").addEventListener("click", () => {
  state.session = null;
  setAuthStatus();
  log("Logged out", "ok");
});

$("healthBtn").addEventListener("click", async () => {
  try {
    const h = await walletHealth();
    log(`Health: ${h.status}`, "ok");
  } catch (e) { log(e.message || String(e), "err"); }
});

$("serverKeysBtn").addEventListener("click", async () => {
  try {
    const k = await walletServerKeys();
    log(`Server keys ok. id:${k.identityPublicKeyHex.substring(0,16)} enc:${k.encryptionPublicKeyHex.substring(0,16)}`, "ok");
  } catch (e) { log(e.message || String(e), "err"); }
});

$("myKeysBtn").addEventListener("click", async () => {
  try {
    const k = await walletMyPublicKeys();
    log(`My keys ok. acct:${k.accountPublicKeyHex.substring(0,16)} enc:${k.encryptionPublicKeyHex.substring(0,16)}`, "ok");
  } catch (e) { log(e.message || String(e), "err"); }
});

function parseJsonOrThrow(text) {
  try { return JSON.parse(text); } catch { throw new Error("Invalid JSON payload"); }
}

$("writePlainBtn").addEventListener("click", async () => {
  const uri = $("plainUri").value.trim();
  const payloadText = $("plainPayload").value.replace(/"timestamp"\s*:\s*""/, `"timestamp":"${new Date().toISOString()}"`);
  if (!uri) return log("Provide unencrypted URI", "err");
  try {
    const data = parseJsonOrThrow(payloadText);
    const resp = await walletProxyWrite(uri, data, false);
    state.lastResolvedUri = resp.resolvedUri || uri;
    log(`Write plain ok ts:${resp.record?.ts ?? "-"}`, "ok");
  } catch (e) { log(e.message || String(e), "err"); }
});

$("writeEncBtn").addEventListener("click", async () => {
  const uri = $("encUri").value.trim();
  const payloadText = $("encPayload").value.replace(/"timestamp"\s*:\s*""/, `"timestamp":"${new Date().toISOString()}"`);
  if (!uri) return log("Provide encrypted URI", "err");
  try {
    const data = parseJsonOrThrow(payloadText);
    const resp = await walletProxyWrite(uri, data, true);
    state.lastResolvedUri = resp.resolvedUri || uri;
    log(`Write enc ok ts:${resp.record?.ts ?? "-"}`, "ok");
  } catch (e) { log(e.message || String(e), "err"); }
});

$("readLastBtn").addEventListener("click", async () => {
  try {
    if (!state.lastResolvedUri) throw new Error("No previous write to read. Perform a write first.");
    const r = await backendRead(state.lastResolvedUri);
    if (r && r.record) {
      const hasAuth = !!r.record.data?.auth;
      const payload = r.record.data?.payload;
      const payloadSummary = payload && typeof payload === "object" ? Object.keys(payload).join(",") : typeof payload;
      log(`Read ok. ts:${r.record.ts} auth:${hasAuth} payload:${payloadSummary}`, "ok");
    } else {
      log("Read ok but no record returned", "err");
    }
  } catch (e) { log(e.message || String(e), "err"); }
});

$("fullTestBtn").addEventListener("click", async () => {
  const username = $("username").value.trim();
  const password = $("password").value.trim();
  if (!username || !password) return log("Provide username and password", "err");
  try {
    // health
    const h = await walletHealth();
    log(`Health: ${h.status}`, "ok");
    // signup
    const sess = await walletSignup(username, password);
    state.session = sess; setAuthStatus();
    log(`Signup ok user:${sess.username}`, "ok");
    // my keys
    const myk = await walletMyPublicKeys();
    log(`My keys acct:${myk.accountPublicKeyHex.substring(0,16)} enc:${myk.encryptionPublicKeyHex.substring(0,16)}`, "ok");
    // write plain
    const plainUri = $("plainUri").value.trim();
    if (!plainUri) throw new Error("Provide unencrypted URI");
    const pp = parseJsonOrThrow($("plainPayload").value.replace(/"timestamp"\s*:\s*""/, `"timestamp":"${new Date().toISOString()}"`));
    const w1 = await walletProxyWrite(plainUri, pp, false);
    state.lastResolvedUri = w1.resolvedUri || plainUri;
    log(`Write plain ok ts:${w1.record?.ts ?? "-"}`, "ok");
    // read back
    const r1 = await backendRead(state.lastResolvedUri);
    log(`Read plain ok ts:${r1.record?.ts ?? "-"}`, "ok");
    // write enc
    const encUri = $("encUri").value.trim();
    if (!encUri) throw new Error("Provide encrypted URI");
    const ep = parseJsonOrThrow($("encPayload").value.replace(/"timestamp"\s*:\s*""/, `"timestamp":"${new Date().toISOString()}"`));
    const w2 = await walletProxyWrite(encUri, ep, true);
    state.lastResolvedUri = w2.resolvedUri || encUri;
    log(`Write enc ok ts:${w2.record?.ts ?? "-"}`, "ok");
    // read back
    const r2 = await backendRead(state.lastResolvedUri);
    const hasAuth = !!r2.record?.data?.auth;
    const hasEncPayload = !!r2.record?.data?.payload?.data && !!r2.record?.data?.payload?.nonce;
    log(`Read enc ok auth:${hasAuth} enc:${hasEncPayload}`, "ok");
    // logout
    state.session = null; setAuthStatus();
    log("Logout ok", "ok");
    // login
    const sess2 = await walletLogin(username, password);
    state.session = sess2; setAuthStatus();
    log(`Login ok`, "ok");
    // final write
    const finalUri = "mutable://accounts/:key/final";
    const fd = { message: "Authentication works after re-login!", timestamp: new Date().toISOString() };
    await walletProxyWrite(finalUri, fd, false);
    log("Final write ok", "ok");
  } catch (e) {
    log(e.message || String(e), "err");
  }
});

// Initialize
try {
  applyConfigFromInputs();
  log(`Config applied: wallet=${state.config.walletUrl} base=${state.config.apiBasePath} backend=${state.config.backendUrl}`, "ok");
} catch (e) {
  log(e.message || String(e), "err");
}
setAuthStatus();
setActiveSection('section-config');
log("Ready. You can use the buttons or adjust config and click Apply.");
