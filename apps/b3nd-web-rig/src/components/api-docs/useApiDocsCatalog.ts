import { useEffect } from "react";
import { useRead } from "../learn/useRead";
import { useApiDocsStore } from "./useApiDocsStore";
import type { ApiCatalog } from "./apiDocsTypes";

const CATALOG_URI = "mutable://open/rig/api-docs/catalog";

/**
 * Loads the API docs catalog into the shared zustand store exactly once.
 * Call this from a single parent component. Children read from the store.
 */
export function useApiDocsCatalog() {
  const { data, loading, error } = useRead<ApiCatalog>(CATALOG_URI);
  const setCatalog = useApiDocsStore((s) => s.setCatalog);
  const setCatalogError = useApiDocsStore((s) => s.setCatalogError);
  const setCatalogLoading = useApiDocsStore((s) => s.setCatalogLoading);

  useEffect(() => {
    if (loading) {
      setCatalogLoading(true);
    } else if (error) {
      setCatalogError(error);
    } else if (data) {
      setCatalog(data);
    }
  }, [data, loading, error, setCatalog, setCatalogError, setCatalogLoading]);
}
