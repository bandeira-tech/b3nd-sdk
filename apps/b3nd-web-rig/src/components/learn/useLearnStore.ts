import { create } from "zustand";
import type { LearnCatalog, LearnChapter } from "./skillContent";
import { useAppStore } from "../../stores/appStore";

interface LearnStore {
  catalog: LearnCatalog | null;
  loading: boolean;
  error: string | null;
  dataSource: "b3nd" | "static" | null;

  activeBook: string | null;
  activeSectionId: string | null;

  /** Currently active chapter key (for multi-chapter books). */
  activeChapter: string | null;

  /** Cache of loaded chapter content, keyed by `${bookKey}/${chapterKey}`. */
  chapterCache: Record<string, LearnChapter>;

  /** Whether a chapter is currently being loaded. */
  chapterLoading: boolean;

  loadCatalog: () => Promise<void>;
  openBook: (key: string) => void;
  closeBook: () => void;
  setActiveSectionId: (id: string | null) => void;

  /** Open a chapter — loads content on demand if not cached. */
  openChapter: (bookKey: string, chapterKey: string) => Promise<void>;
  closeChapter: () => void;
}

function resolveB3ndUrl(): string {
  const appState = useAppStore.getState();
  const activeBackend = appState.backends.find(
    (b) => b.id === appState.activeBackendId,
  );
  return activeBackend?.adapter?.baseUrl || "";
}

/** Convert a b3nd URI like `mutable://open/rig/learn/chapters/x/y` to an API path. */
function uriToApiPath(uri: string): string {
  // mutable://open/rig/learn/chapters/message-guide/01-two-friends
  // → /api/v1/read/mutable/open/rig/learn/chapters/message-guide/01-two-friends
  return "/api/v1/read/" + uri.replace("://", "/");
}

/** Convert a b3nd URI to a static fallback path. */
function uriToStaticPath(uri: string): string {
  // Extract the chapter key from the URI and build a static path
  // mutable://open/rig/learn/chapters/message-guide/01-two-friends
  // → /learn/chapters/01-two-friends.json
  const parts = uri.split("/");
  const chapterKey = parts[parts.length - 1];
  return `/learn/chapters/${chapterKey}.json`;
}

export const useLearnStore = create<LearnStore>((set, get) => ({
  catalog: null,
  loading: false,
  error: null,
  dataSource: null,

  activeBook: null,
  activeSectionId: null,
  activeChapter: null,
  chapterCache: {},
  chapterLoading: false,

  loadCatalog: async () => {
    // Skip if already loaded or currently loading
    const { catalog, loading } = get();
    if (catalog || loading) return;

    set({ loading: true, error: null });

    const b3ndUrl = resolveB3ndUrl();

    // Try B3nd first
    if (b3ndUrl) {
      try {
        const res = await fetch(
          `${b3ndUrl}/api/v1/read/mutable/open/rig/learn/catalog`,
        );
        if (res.ok) {
          const record = await res.json();
          const data: LearnCatalog = record.data ?? record;
          if (data.books && data.books.length > 0) {
            set({ catalog: data, loading: false, dataSource: "b3nd" });
            return;
          }
        }
      } catch {
        // B3nd unavailable, fall through to static
      }
    }

    // Static file fallback
    try {
      const res = await fetch("/learn/catalog.json");
      if (!res.ok) {
        throw new Error(`Failed to load learn catalog: ${res.status}`);
      }
      const data: LearnCatalog = await res.json();
      set({ catalog: data, loading: false, dataSource: "static" });
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  openBook: (key) => set({ activeBook: key, activeSectionId: null, activeChapter: null }),
  closeBook: () => set({ activeBook: null, activeSectionId: null, activeChapter: null }),
  setActiveSectionId: (id) => set({ activeSectionId: id }),

  openChapter: async (bookKey, chapterKey) => {
    const cacheKey = `${bookKey}/${chapterKey}`;
    const { chapterCache, catalog, dataSource } = get();

    // Already cached — just activate
    if (chapterCache[cacheKey]) {
      set({ activeChapter: chapterKey, activeSectionId: null });
      return;
    }

    // Find the chapter metadata to get its URI
    const book = catalog?.books.find((b) => b.key === bookKey);
    const chapterMeta = book?.chapters?.find((c) => c.key === chapterKey);
    if (!chapterMeta) {
      console.warn(`Chapter ${chapterKey} not found in book ${bookKey}`);
      return;
    }

    set({ chapterLoading: true, activeChapter: chapterKey, activeSectionId: null });

    const b3ndUrl = resolveB3ndUrl();
    let chapter: LearnChapter | null = null;

    // Try B3nd first (if that's where the catalog came from)
    if (b3ndUrl && dataSource === "b3nd") {
      try {
        const apiPath = uriToApiPath(chapterMeta.uri);
        const res = await fetch(`${b3ndUrl}${apiPath}`);
        if (res.ok) {
          const record = await res.json();
          const data = record.data ?? record;
          chapter = { ...chapterMeta, markdown: data.markdown };
        }
      } catch {
        // Fall through to static
      }
    }

    // Static fallback
    if (!chapter) {
      try {
        const staticPath = uriToStaticPath(chapterMeta.uri);
        const res = await fetch(staticPath);
        if (res.ok) {
          const data = await res.json();
          chapter = { ...chapterMeta, markdown: data.markdown };
        }
      } catch {
        // Failed to load
      }
    }

    if (chapter) {
      set((state) => ({
        chapterCache: { ...state.chapterCache, [cacheKey]: chapter },
        chapterLoading: false,
      }));
    } else {
      console.warn(`Failed to load chapter ${chapterKey}`);
      set({ chapterLoading: false });
    }
  },

  closeChapter: () => set({ activeChapter: null, activeSectionId: null }),
}));
