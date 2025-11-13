// Minimal browser-ready AppsClient (ESM) for writer app
export class AppsClient {
  constructor(cfg) {
    if (!cfg || !cfg.appServerUrl || !cfg.apiBasePath) throw new Error('appServerUrl and apiBasePath required');
    this.base = cfg.appServerUrl.replace(/\/$/, '');
    this.api = (cfg.apiBasePath.startsWith('/') ? cfg.apiBasePath : `/${cfg.apiBasePath}`).replace(/\/$/, '');
    this.f = cfg.fetch || fetch;
  }
  async health() {
    const r = await this.f(`${this.base}${this.api}/health`);
    if (!r.ok) throw new Error(`health failed: ${r.statusText}`);
    return r.json();
  }
  async registerApp(reg) {
    const r = await this.f(`${this.base}${this.api}/apps/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reg) });
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || r.statusText);
    return j;
  }
  async updateSchema(appKey, actions) {
    const r = await this.f(`${this.base}${this.api}/apps/${encodeURIComponent(appKey)}/schema`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(actions) });
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || r.statusText);
    return j;
  }
  async createSession(appKey, token) {
    const r = await this.f(`${this.base}${this.api}/app/${encodeURIComponent(appKey)}/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || r.statusText);
    return j;
  }
  async invokeAction(appKey, action, payload, origin) {
    const r = await this.f(`${this.base}${this.api}/app/${encodeURIComponent(appKey)}/${encodeURIComponent(action)}`, { method: 'POST', headers: { 'Content-Type': 'text/plain', ...(origin ? { Origin: origin } : {}) }, body: payload });
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || r.statusText);
    return j;
  }
}

