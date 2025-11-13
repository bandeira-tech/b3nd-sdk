import { WalletClient } from "../sdk/build/wallet-client.js";
import { AppsClient } from "../sdk/build/apps-client.js";
import { HttpClient } from "../sdk/build/http-client.js";

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
  clients: { wallet: null, apps: null, backend: null },
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
  const data = await state.clients.wallet.health();
  setOutput(data);
  return data;
}

async function walletServerKeys() {
  requireConfig();
  const data = await state.clients.wallet.getServerKeys();
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
  state.clients.wallet.setSession(state.session);
  const data = await state.clients.wallet.getPublicKeys();
  setOutput(data);
  return data;
}

async function walletProxyWrite(uri, data, encrypt) {
  requireConfig();
  requireAuth();
  state.clients.wallet.setSession(state.session);
  const resp = await state.clients.wallet.proxyWrite({ uri, data, encrypt: !!encrypt });
  setOutput(resp);
  return resp;
}

// Backend read
async function backendRead(uri) {
  requireConfig();
  const data = await state.clients.backend.read(uri);
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
  const appServerUrl = $("appServerUrl").value.trim();
  const appApiBasePath = $("appApiBasePath").value.trim();
  if (!walletUrl || !apiBasePath || !backendUrl) {
    throw new Error("Please provide Wallet Server URL, API Base Path, and Backend URL.");
  }
  state.config = {
    walletUrl: normalizeBase(walletUrl),
    apiBasePath: normalizeApiBasePath(apiBasePath),
    backendUrl: normalizeBase(backendUrl),
    backendInstance,
    appServerUrl: appServerUrl ? normalizeBase(appServerUrl) : undefined,
    appApiBasePath: appApiBasePath ? normalizeApiBasePath(appApiBasePath) : undefined,
  };
  // Initialize clients
  state.clients.wallet = new WalletClient({ walletServerUrl: state.config.walletUrl, apiBasePath: state.config.apiBasePath });
  state.clients.apps = state.config.appServerUrl && state.config.appApiBasePath ? new AppsClient({ appServerUrl: state.config.appServerUrl, apiBasePath: state.config.appApiBasePath }) : null;
  state.clients.backend = new HttpClient({ url: state.config.backendUrl });
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
  if (cfg.appServerUrl) $("appServerUrl").value = cfg.appServerUrl;
  if (cfg.appApiBasePath) $("appApiBasePath").value = cfg.appApiBasePath;
}

function clearConfig() {
  localStorage.removeItem("b3nd-writer-config");
}

// App backend calls
function requireAppConfig() {
  if (!state.config?.appServerUrl || !state.config?.appApiBasePath) {
    throw new Error("App server config not applied");
  }
}

async function appRegister(reg) {
  requireAppConfig();
  if (!state.clients.apps) state.clients.apps = new AppsClient({ appServerUrl: state.config.appServerUrl, apiBasePath: state.config.appApiBasePath });
  const j = await state.clients.apps.registerApp(reg);
  setOutput(j);
  return j;
}

async function appUpdateSchema(appKey, actions) {
  requireAppConfig();
  if (!state.clients.apps) state.clients.apps = new AppsClient({ appServerUrl: state.config.appServerUrl, apiBasePath: state.config.appApiBasePath });
  const j = await state.clients.apps.updateSchema(appKey, actions);
  setOutput(j);
  return j;
}

async function appInvoke(appKey, action, payload) {
  requireAppConfig();
  if (!state.clients.apps) state.clients.apps = new AppsClient({ appServerUrl: state.config.appServerUrl, apiBasePath: state.config.appApiBasePath });
  const j = await state.clients.apps.invokeAction(appKey, action, payload, location.origin);
  setOutput(j);
  return j;
}

async function appCreateSession(appKey, token) {
  requireAppConfig();
  if (!state.clients.apps) state.clients.apps = new AppsClient({ appServerUrl: state.config.appServerUrl, apiBasePath: state.config.appApiBasePath });
  const j = await state.clients.apps.createSession(appKey, token);
  setOutput(j);
  return j;
}

// App key generation
async function generateEd25519() {
  const kp = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const priv = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
  const pub = await crypto.subtle.exportKey("raw", kp.publicKey);
  const privB64 = btoa(String.fromCharCode(...new Uint8Array(priv)));
  const privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${privB64.match(/.{1,64}/g).join("\n")}\n-----END PRIVATE KEY-----`;
  const publicKeyHex = Array.from(new Uint8Array(pub)).map(b=>b.toString(16).padStart(2,"0")).join("");
  return { privateKeyPem, publicKeyHex };
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

  // App setup
  $("genAppKeys").addEventListener("click", async () => {
    try {
      const k = await generateEd25519();
      $("appKey").value = k.publicKeyHex;
      $("appPrivPem").value = k.privateKeyPem;
      log("Generated app keys", "ok");
      setOutput(k);
    } catch (e) { log(e.message || String(e), "err"); }
  });

  $("registerAppBtn").addEventListener("click", async () => {
    try {
      const appKey = $("appKey").value.trim();
      const appPrivPem = $("appPrivPem").value.trim();
      const origins = $("appOrigins").value.split(",").map(s=>s.trim()).filter(Boolean);
      const actionName = $("appActionName").value.trim();
      const fmt = $("appValidationFormat").value.trim();
      const plain = $("appWritePlain").value.trim();
      if (!appKey || !appPrivPem || !actionName) throw new Error("missing appKey/appPrivPem/actionName");
      const actions = [{ action: actionName, validation: { stringValue: fmt ? { format: fmt } : {} }, write: { plain } }];
      await appRegister({ appKey, accountPrivateKeyPem: appPrivPem, allowedOrigins: origins.length ? origins : ["*"], actions });
      log("App registered", "ok");
    } catch (e) { log(e.message || String(e), "err"); }
  });

  $("updateSchemaBtn").addEventListener("click", async () => {
    try {
      const appKey = $("appKey").value.trim();
      const actionName = $("appActionName").value.trim();
      const fmt = $("appValidationFormat").value.trim();
      const plain = $("appWritePlain").value.trim();
      if (!appKey || !actionName) throw new Error("missing appKey/actionName");
      const actions = [{ action: actionName, validation: { stringValue: fmt ? { format: fmt } : {} }, write: { plain } }];
      await appUpdateSchema(appKey, actions);
      log("Schema updated", "ok");
    } catch (e) { log(e.message || String(e), "err"); }
  });

  $("createSessionBtn").addEventListener("click", async () => {
    try {
      const appKey = $("appKey").value.trim();
      const token = $("appToken").value.trim() || (($("appKey").value.trim()) + "." );
      if (!appKey) throw new Error("missing appKey");
      if (!token) throw new Error("missing token");
      const res = await appCreateSession(appKey, token);
      $("appSession").value = res.session;
      log("Session created", "ok");
    } catch (e) { log(e.message || String(e), "err"); }
  });

  $("invokeActionBtn").addEventListener("click", async () => {
    try {
      const appKey = $("appKey").value.trim();
      const action = $("invokeActionName").value.trim();
      const payload = $("invokePayload").value.trim();
      if (!appKey || !action) throw new Error("missing appKey/action");
      const j = await appInvoke(appKey, action, payload);
      log(`Invoked action -> ${j.uri}`, "ok");
    } catch (e) { log(e.message || String(e), "err"); }
  });

  $("signupBtn").addEventListener("click", async () => {
  const username = $("username").value.trim();
  const password = $("password").value.trim();
  const token = $("appToken").value.trim();
  if (!username || !password || !token) return log("Provide token, username, password", "err");
  try {
      const sess = await state.clients.wallet.signupWithToken(token, { username, password });
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
  const token = $("appToken").value.trim();
  const sessionKey = $("appSession").value.trim();
  if (!username || !password || !token || !sessionKey) return log("Provide token, session, username, password", "err");
  try {
      const sess = await state.clients.wallet.loginWithTokenSession(token, sessionKey, { username, password });
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
