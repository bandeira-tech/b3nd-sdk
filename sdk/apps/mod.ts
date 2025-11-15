/**
 * @b3nd/sdk/apps
 * Lightweight client for the App Backend installation.
 */

export interface AppsClientConfig {
  appServerUrl: string;
  apiBasePath: string;
  fetch?: typeof fetch;
  authToken?: string;
}

export interface AppActionDef {
  action: string;
  validation?: { stringValue?: { format?: "email" } };
  write: { encrypted?: string; plain?: string };
}

export interface AppRegistration {
  appKey: string;
  accountPrivateKeyPem: string;
  encryptionPublicKeyHex?: string;
  encryptionPrivateKeyPem?: string;
  allowedOrigins: string[];
  actions: AppActionDef[];
}

export class AppsClient {
  private base: string;
  private api: string;
  private f: typeof fetch;
  private authToken?: string;

  constructor(cfg: AppsClientConfig) {
    if (!cfg.appServerUrl) throw new Error("appServerUrl is required");
    if (!cfg.apiBasePath) throw new Error("apiBasePath is required");
    this.base = cfg.appServerUrl.replace(/\/$/, "");
    this.api = (cfg.apiBasePath.startsWith("/") ? cfg.apiBasePath : `/${cfg.apiBasePath}`).replace(/\/$/, "");
    if (cfg.authToken) this.authToken = cfg.authToken;
    if (cfg.fetch) {
      this.f = cfg.fetch;
    } else if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
      this.f = window.fetch.bind(window);
    } else {
      this.f = fetch;
    }
  }

  setAuthToken(token?: string) {
    this.authToken = token;
  }

  async health(): Promise<unknown> {
    const r = await this.f(`${this.base}${this.api}/health`);
    if (!r.ok) throw new Error(`health failed: ${r.statusText}`);
    return r.json();
  }

  async registerApp(reg: AppRegistration): Promise<{ success: boolean; error?: string }> {
    const r = await this.f(`${this.base}${this.api}/apps/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}) },
      body: JSON.stringify(reg),
    });
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || r.statusText);
    return j;
  }

  async updateSchema(appKey: string, actions: AppActionDef[]): Promise<{ success: boolean; error?: string }> {
    const r = await this.f(`${this.base}${this.api}/apps/${encodeURIComponent(appKey)}/schema`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}) },
      body: JSON.stringify(actions),
    });
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || r.statusText);
    return j;
  }

  async getSchema(appKey: string): Promise<{ success: true; config: { appKey: string; allowedOrigins: string[]; actions: AppActionDef[] } }> {
    const r = await this.f(`${this.base}${this.api}/apps/${encodeURIComponent(appKey)}/schema`, { headers: { ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}) } });
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || r.statusText);
    return j;
  }

  async createSession(appKey: string, token: string): Promise<{ success: true; session: string; uri: string }> {
    const r = await this.f(`${this.base}${this.api}/app/${encodeURIComponent(appKey)}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || r.statusText);
    return j as { success: true; session: string; uri: string };
  }

  async invokeAction(appKey: string, action: string, payload: string, origin?: string): Promise<{ success: true; uri: string; record: { ts: number; data: unknown } }> {
    const r = await this.f(`${this.base}${this.api}/app/${encodeURIComponent(appKey)}/${encodeURIComponent(action)}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", ...(origin ? { Origin: origin } : {}) },
      body: payload,
    });
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || r.statusText);
    return j as { success: true; uri: string; record: { ts: number; data: unknown } };
  }

  async read(appKey: string, uri: string): Promise<{ success: true; uri: string; record: { ts: number; data: unknown }; raw?: unknown }> {
    const u = new URL(`${this.base}${this.api}/app/${encodeURIComponent(appKey)}/read`);
    u.searchParams.set("uri", uri);
    const r = await this.f(u.toString());
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || r.statusText);
    return j;
  }
}
