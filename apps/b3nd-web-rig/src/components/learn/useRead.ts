import { useState, useEffect } from "react";
import { useAppStore } from "../../stores/appStore";

/**
 * Read from a b3nd URI. Tries the active backend first, falls back to static.
 * No caching — data lives in component state and is released on unmount.
 * Whether to cache is a client/transport concern, not an app concern.
 */
export function useRead<T = unknown>(uri: string | null): {
  data: T | null;
  loading: boolean;
  error: string | null;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baseUrl = useAppStore((s) => {
    const backend = s.backends.find((b) => b.id === s.activeBackendId);
    return backend?.adapter?.baseUrl ?? "";
  });

  useEffect(() => {
    if (!uri) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    (async () => {
      // Try b3nd client
      if (baseUrl) {
        try {
          const apiPath = "/api/v1/read/" + uri.replace("://", "/");
          const res = await fetch(`${baseUrl}${apiPath}`);
          if (res.ok && !cancelled) {
            const json = await res.json();
            setData((json.data ?? json) as T);
            setLoading(false);
            return;
          }
        } catch {
          // fall through to static
        }
      }

      // Static fallback
      const staticPath = resolveStaticPath(uri);
      if (staticPath) {
        try {
          const res = await fetch(staticPath);
          if (res.ok && !cancelled) {
            setData((await res.json()) as T);
            setLoading(false);
            return;
          }
        } catch {
          // fall through to error
        }
      }

      if (!cancelled) {
        setError(`Failed to read ${uri}`);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [uri, baseUrl]);

  return { data, loading, error };
}

function resolveStaticPath(uri: string): string | null {
  if (uri === "mutable://open/rig/learn/catalog") return "/learn/catalog.json";
  const chapterMatch = uri.match(/\/chapters\/[^/]+\/(.+)$/);
  if (chapterMatch) return `/learn/chapters/${chapterMatch[1]}.json`;
  return null;
}
