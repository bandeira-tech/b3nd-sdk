/**
 * @b3nd/sdk/apps
 * Lightweight client for the App Backend installation.
 */

export interface AppsClientConfig {
  appServerUrl: string;
  apiBasePath: string;
  fetch?: typeof fetch;
}

export interface AppActionDef {
  action: string;
  validation?: { stringValue?: { format?: "email" } };
  write: { encrypted?: string; plain?: string };
}

export type AuthenticatedMessage<T = unknown> = {
  auth: Array<{ pubkey: string; signature: string }>;
  payload: T;
};

export class AppsClient {
  private base: string;
  private api: string;
  private f: typeof fetch;

  constructor(cfg: AppsClientConfig) {
    if (!cfg.appServerUrl) throw new Error("appServerUrl is required");
    if (!cfg.apiBasePath) throw new Error("apiBasePath is required");
    this.base = cfg.appServerUrl.replace(/\/$/, "");
    this.api =
      (cfg.apiBasePath.startsWith("/")
        ? cfg.apiBasePath
        : `/${cfg.apiBasePath}`).replace(/\/$/, "");
    if (cfg.fetch) {
      this.f = cfg.fetch;
    } else if (
      typeof window !== "undefined" && typeof window.fetch === "function"
    ) {
      this.f = window.fetch.bind(window);
    } else {
      this.f = fetch;
    }
  }

  async health(): Promise<unknown> {
    const r = await this.f(`${this.base}${this.api}/health`);
    if (!r.ok) throw new Error(`health failed: ${r.statusText}`);
    return r.json();
  }

  async updateOrigins(
    appKey: string,
    message: AuthenticatedMessage<
      { allowedOrigins?: string[]; encryptionPublicKeyHex?: string | null }
    >,
  ): Promise<{ success: boolean }> {
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

  async updateGoogleClientId(
    appKey: string,
    message: AuthenticatedMessage<{ googleClientId: string | null }>,
  ): Promise<{ success: boolean }> {
    const r = await this.f(
      `${this.base}${this.api}/apps/google-client-id/${
        encodeURIComponent(appKey)
      }`,
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

  async updateSchema(
    appKey: string,
    message: AuthenticatedMessage<
      { actions: AppActionDef[]; encryptionPublicKeyHex?: string | null }
    >,
  ): Promise<{ success: boolean; error?: string }> {
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

  async getSchema(
    appKey: string,
  ): Promise<
    {
      success: true;
      config: {
        appKey: string;
        allowedOrigins: string[];
        actions: AppActionDef[];
        encryptionPublicKeyHex?: string | null;
      };
    }
  > {
    const r = await this.f(
      `${this.base}${this.api}/apps/schema/${encodeURIComponent(appKey)}`,
    );
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || r.statusText);
    return j;
  }

  async createSession(
    appKey: string,
    message: AuthenticatedMessage<{ session: string }>,
  ): Promise<{ success: true; session: string; uri: string }> {
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
    return j as { success: true; session: string; uri: string };
  }

  async invokeAction(
    appKey: string,
    action: string,
    signedMessage: AuthenticatedMessage<any>,
    origin?: string,
  ): Promise<
    { success: true; uri: string; record: { ts: number; data: unknown } }
  > {
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
    return j as {
      success: true;
      uri: string;
      record: { ts: number; data: unknown };
    };
  }

  async read(
    appKey: string,
    uri: string,
  ): Promise<
    {
      success: true;
      uri: string;
      record: { ts: number; data: unknown };
      raw?: unknown;
    }
  > {
    const u = new URL(
      `${this.base}${this.api}/app/${encodeURIComponent(appKey)}/read`,
    );
    u.searchParams.set("uri", uri);
    const r = await this.f(u.toString());
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || r.statusText);
    return j;
  }
}
