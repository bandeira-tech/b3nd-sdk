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
  async signupWithToken(appKey, tokenOrCredentials, maybeCredentials) {
    if (!appKey) throw new Error("appKey required");
    const credentials = typeof tokenOrCredentials === "string" ? maybeCredentials : tokenOrCredentials;
    if (!credentials) throw new Error("credentials required");
    const r = await this._fetch(`${this.walletServerUrl}${this.apiBasePath}/auth/signup/${appKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: typeof tokenOrCredentials === "string" ? tokenOrCredentials : undefined, type: "password", username: credentials.username, password: credentials.password }) });
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || r.statusText);
    return { username: j.username, token: j.token, expiresIn: j.expiresIn };
  }
  async loginWithTokenSession(appKey, tokenOrSession, sessionOrCredentials, maybeCredentials) {
    if (!appKey) throw new Error("appKey required");
    const session = typeof sessionOrCredentials === "string" && maybeCredentials ? sessionOrCredentials : tokenOrSession;
    const credentials = maybeCredentials || sessionOrCredentials;
    if (!session) throw new Error("session required");
    const r = await this._fetch(`${this.walletServerUrl}${this.apiBasePath}/auth/login/${appKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: typeof tokenOrSession === "string" && maybeCredentials ? tokenOrSession : undefined, session, type: "password", username: credentials.username, password: credentials.password }) });
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || r.statusText);
    return { username: j.username, token: j.token, expiresIn: j.expiresIn };
  }
  async requestPasswordResetWithToken(appKey, tokenOrUsername, maybeUsername) {
    if (!appKey) throw new Error("appKey required");
    const username = maybeUsername || tokenOrUsername;
    const r = await this._fetch(`${this.walletServerUrl}${this.apiBasePath}/auth/credentials/request-password-reset/${appKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }) });
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || r.statusText);
    return { resetToken: j.resetToken, expiresIn: j.expiresIn };
  }
  async resetPasswordWithToken(appKey, tokenOrUsername, usernameOrReset, resetToken, newPassword) {
    if (!appKey) throw new Error("appKey required");
    const username = usernameOrReset;
    if (!resetToken || !newPassword) throw new Error("resetToken and newPassword required");
    const r = await this._fetch(`${this.walletServerUrl}${this.apiBasePath}/auth/credentials/reset-password/${appKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, resetToken, newPassword }) });
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || r.statusText);
    return { username: j.username, token: j.token, expiresIn: j.expiresIn };
  }
  async getPublicKeys(appKey) {
    if (!this._session) throw new Error('Not authenticated. Please login first.');
    if (!appKey) throw new Error("appKey required");
    const r = await this._fetch(`${this.walletServerUrl}${this.apiBasePath}/auth/public-keys/${appKey}`, { headers: { Authorization: `Bearer ${this._session.token}` } });
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
