// Minimal browser-ready AppsClient (ESM) for writer app
export class AppsClient {
  constructor(cfg) {
    if (!cfg || !cfg.appServerUrl || !cfg.apiBasePath) {
      throw new Error("appServerUrl and apiBasePath required");
    }
    this.base = cfg.appServerUrl.replace(/\/$/, "");
    this.api =
      (cfg.apiBasePath.startsWith("/")
        ? cfg.apiBasePath
        : `/${cfg.apiBasePath}`).replace(/\/$/, "");
    this.f = cfg.fetch || fetch;
  }
  async health() {
    const r = await this.f(`${this.base}${this.api}/health`);
    if (!r.ok) throw new Error(`health failed: ${r.statusText}`);
    return r.json();
  }
  async updateOrigins(appKey, message) {
    const r = await this.f(
      `${this.base}${this.api}/apps/origins/${encodeURIComponent(appKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
      },
    );
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || r.statusText);
    return j;
  }
  async updateSchema(appKey, message) {
    const r = await this.f(
      `${this.base}${this.api}/apps/schema/${encodeURIComponent(appKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
      },
    );
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || r.statusText);
    return j;
  }
  async getSchema(appKey) {
    const r = await this.f(
      `${this.base}${this.api}/apps/schema/${encodeURIComponent(appKey)}`,
    );
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || r.statusText);
    return j;
  }
  async createSession(appKey, message) {
    const r = await this.f(
      `${this.base}${this.api}/app/${encodeURIComponent(appKey)}/session`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
      },
    );
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || r.statusText);
    return j;
  }
  async invokeAction(appKey, action, signedMessage, origin) {
    const r = await this.f(
      `${this.base}${this.api}/app/${encodeURIComponent(appKey)}/${
        encodeURIComponent(action)
      }`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(origin ? { Origin: origin } : {}),
        },
        body: JSON.stringify(signedMessage),
      },
    );
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || r.statusText);
    return j;
  }
}
