import { useEffect, useRef, useState } from "react";

let googleScriptPromise: Promise<void> | null = null;

type GoogleAccounts = {
  accounts?: {
    id?: {
      initialize: (config: unknown) => void;
      renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
    };
  };
};

export function AuthSection(props: {
  disabled: boolean;
  googleEnabled: boolean;
  googleClientId: string;
  signup: (u: string, p: string) => void;
  login: (u: string, p: string) => void;
  onGoogleCredential: (mode: "signup" | "login", idToken: string) => void;
  primaryButtonClass: string;
  secondaryButtonClass: string;
  disabledClass: string;
}) {
  const {
    disabled,
    googleEnabled,
    googleClientId,
    signup,
    login,
    onGoogleCredential,
    primaryButtonClass,
    secondaryButtonClass,
    disabledClass,
  } = props;
  const [authMode, setAuthMode] = useState<"signup" | "login">("signup");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const [googleReady, setGoogleReady] = useState(false);
  const authModeRef = useRef<"signup" | "login">(authMode);
  const googleClientIdRef = useRef<string | null>(null);

  const handleAuth = () => {
    if (disabled) return;
    if (authMode === "signup") {
      signup(username, password);
    } else {
      login(username, password);
    }
  };

  const handleModeChange = (mode: "signup" | "login") => {
    setAuthMode(mode);
    authModeRef.current = mode;
  };

  useEffect(() => {
    authModeRef.current = authMode;

    const clientId = googleClientId.trim();
    if (!googleEnabled || disabled || !clientId) {
      if (googleButtonRef.current) {
        googleButtonRef.current.innerHTML = "";
      }
      setGoogleReady(false);
      return;
    }

    const getGoogleAccounts = () =>
      (window as Window & typeof globalThis & { google?: GoogleAccounts }).google;

    if (!googleScriptPromise) {
      googleScriptPromise = new Promise<void>((resolve) => {
        if (getGoogleAccounts()?.accounts?.id) {
          resolve();
          return;
        }
        const existing = document.querySelector(
          'script[src="https://accounts.google.com/gsi/client"]',
        ) as HTMLScriptElement | null;
        if (existing) {
          existing.addEventListener("load", () => resolve(), { once: true });
          return;
        }
        const script = document.createElement("script");
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        document.head.appendChild(script);
      });
    }

    let cancelled = false;
    googleScriptPromise.then(() => {
      if (cancelled) return;
      const google = getGoogleAccounts();
      const googleApi = google?.accounts?.id;
      if (!googleApi || !googleButtonRef.current) return;

      if (googleClientIdRef.current !== clientId) {
        googleApi.initialize({
          client_id: clientId,
          callback: (response: { credential?: string }) => {
            if (response.credential) {
              onGoogleCredential(authModeRef.current, response.credential);
            }
          },
        });
        googleClientIdRef.current = clientId;
      }

      googleButtonRef.current.innerHTML = "";
      googleApi.renderButton(googleButtonRef.current, {
        theme: "outline",
        size: "large",
        type: "standard",
        text: authModeRef.current === "signup" ? "signup_with" : "signin_with",
        shape: "rectangular",
        logo_alignment: "left",
      });
      setGoogleReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [
    authMode,
    disabled,
    googleClientId,
    googleEnabled,
    onGoogleCredential,
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => handleModeChange("signup")}
          className={`${authMode === "signup" ? primaryButtonClass : secondaryButtonClass} ${disabled ? disabledClass : ""}`}
          disabled={disabled}
        >
          Signup
        </button>
        <button
          onClick={() => handleModeChange("login")}
          className={`${authMode === "login" ? primaryButtonClass : secondaryButtonClass} ${disabled ? disabledClass : ""}`}
          disabled={disabled}
        >
          Login
        </button>
      </div>

      <div className="space-y-4">
        <div className="grid md:grid-cols-2 gap-3">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
            disabled={disabled}
          />
          <input
            value={password}
            type="password"
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
            disabled={disabled}
          />
        </div>
        <button
          onClick={handleAuth}
          className={`${primaryButtonClass} ${disabled ? disabledClass : ""}`}
          disabled={disabled}
        >
          Continue with Username & Password
        </button>

        {googleEnabled && (
          <div className="space-y-3">
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">
                Continue with Google ({authMode})
              </label>
              <div
                ref={googleButtonRef}
                className={disabled ? "opacity-50 pointer-events-none" : ""}
              />
            </div>
            {!googleReady && (
              <div className="text-xs text-muted-foreground">
                Loading Google auth…
              </div>
            )}
          </div>
        )}

        {disabled && (
          <div className="text-xs text-muted-foreground">
            Start a session to enable authentication.
          </div>
        )}
      </div>
    </div>
  );
}
