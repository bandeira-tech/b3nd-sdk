// Minimal browser-ready WalletClient (ESM) for writer app
export class WalletClient {
  constructor(config) {
    if (!config || !config.walletServerUrl || !config.apiBasePath) throw new Error("walletServerUrl and apiBasePath required");
    this.walletServerUrl = config.walletServerUrl.replace(/\/$/, "");
    this.apiBasePath = (config.apiBasePath.startsWith("/") ? config.apiBasePath : `/${config.apiBasePath}`).replace(/\/$/, "");
    this._fetch = config.fetch || fetch;
    this._session = null;
  }
  setSession(s) { this._session = s; }
  getSession() { return this._session; }
  isAuthenticated() { return !!this._session; }
  getUsername() { return this._session?.username || null; }
  getToken() { return this._session?.token || null; }
  logout() { this._session = null; }
  async health() {
    const r = await this._fetch(`${this.walletServerUrl}${this.apiBasePath}/health`);
    if (!r.ok) throw new Error(`Health failed: ${r.statusText}`);
    return await r.json();
  }
  async signupWithToken(token, credentials) {
    const r = await this._fetch(`${this.walletServerUrl}${this.apiBasePath}/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, username: credentials.username, password: credentials.password }) });
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || r.statusText);
    return { username: j.username, token: j.token, expiresIn: j.expiresIn };
  }
  async loginWithTokenSession(token, session, credentials) {
    const r = await this._fetch(`${this.walletServerUrl}${this.apiBasePath}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, session, username: credentials.username, password: credentials.password }) });
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || r.statusText);
    return { username: j.username, token: j.token, expiresIn: j.expiresIn };
  }
  async requestPasswordResetWithToken(token, username) {
    const r = await this._fetch(`${this.walletServerUrl}${this.apiBasePath}/auth/request-password-reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, username }) });
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || r.statusText);
    return { resetToken: j.resetToken, expiresIn: j.expiresIn };
  }
  async resetPasswordWithToken(token, username, resetToken, newPassword) {
    const r = await this._fetch(`${this.walletServerUrl}${this.apiBasePath}/auth/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, username, resetToken, newPassword }) });
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || r.statusText);
    return { username: j.username, token: j.token, expiresIn: j.expiresIn };
  }
  async getPublicKeys() {
    if (!this._session) throw new Error('Not authenticated. Please login first.');
    const r = await this._fetch(`${this.walletServerUrl}${this.apiBasePath}/public-keys`, { headers: { Authorization: `Bearer ${this._session.token}` } });
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || r.statusText);
    return { accountPublicKeyHex: j.accountPublicKeyHex, encryptionPublicKeyHex: j.encryptionPublicKeyHex };
  }
  async proxyWrite({ uri, data, encrypt }) {
    if (!this._session) throw new Error('Not authenticated. Please login first.');
    const r = await this._fetch(`${this.walletServerUrl}${this.apiBasePath}/proxy/write`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this._session.token}` }, body: JSON.stringify({ uri, data, encrypt: !!encrypt }) });
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || r.statusText);
    return j;
  }
  async getServerKeys() {
    const r = await this._fetch(`${this.walletServerUrl}${this.apiBasePath}/server-keys`);
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || r.statusText);
    return { identityPublicKeyHex: j.identityPublicKeyHex, encryptionPublicKeyHex: j.encryptionPublicKeyHex };
  }
}

