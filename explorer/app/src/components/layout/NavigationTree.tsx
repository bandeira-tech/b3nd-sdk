import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../../stores/appStore";
import { routeForExplorerPath } from "../../utils";
import type { NavigationNode } from "../../types";
import { Folder } from "lucide-react";
import { TreeNode } from "./TreeNode";

export function NavigationTree() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Get root nodes from store (schema-driven)
  const rootNodes = useAppStore((state) => state.rootNodes);
  const schemas = useAppStore((state) => state.schemas);
  const activeBackend = useAppStore((state) =>
    state.backends.find((b) => b.id === state.activeBackendId),
  );
  const { expandedPaths, togglePathExpansion, loadSchemas } = useAppStore();
  const navigate = useNavigate();

  console.log("[NavigationTree] Render. rootNodes:", rootNodes, "schemas:", Object.keys(schemas), "activeBackend:", activeBackend?.id, "loading:", loading);

  useEffect(() => {
    console.log("[NavigationTree:useEffect] activeBackend.id changed:", activeBackend?.id);

    if (!activeBackend?.adapter) {
      console.log("[NavigationTree:useEffect] No active backend");
      setError("No active backend");
      setLoading(false);
      return;
    }

    const loadRoot = async () => {
      try {
        console.log("[NavigationTree:loadRoot] Starting. Current schemas:", Object.keys(schemas));
        setLoading(true);
        setError(null);

        // Load schemas if not already loaded
        if (Object.keys(schemas).length === 0) {
          console.log("[NavigationTree:loadRoot] Schemas empty, calling loadSchemas()");
          await loadSchemas();
          console.log("[NavigationTree:loadRoot] loadSchemas() completed");
        } else {
          // Schemas already loaded, just stop loading
          console.log("[NavigationTree:loadRoot] Schemas already loaded");
          setLoading(false);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        console.error("[NavigationTree:loadRoot] Error:", errMsg);
        setError(
          `Failed to load navigation: ${errMsg}`,
        );
      } finally {
        setLoading(false);
      }
    };

    loadRoot();
    // Only depend on activeBackendId to avoid re-running when loadSchemas function changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBackend?.id]);

  const handleToggle = useCallback(
    (path: string) => {
      togglePathExpansion(path);
    },
    [togglePathExpansion],
  );

  const handleNodeClick = useCallback(
    (node: NavigationNode) => {
      if (node.type === "directory") {
        handleToggle(node.path);
        navigate(routeForExplorerPath(node.path));
      } else {
        navigate(routeForExplorerPath(node.path));
      }
    },
    [navigate, handleToggle],
  );

  if (loading) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        Loading navigation...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center text-destructive">Error: {error}</div>
    );
  }

  return (
    <div className="p-4 space-y-2">
      <div className="flex items-center space-x-2 text-sm font-medium mb-4">
        <Folder className="h-4 w-4" />
        <span>Root Directory</span>
      </div>
      <div className="space-y-1">
        {rootNodes.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            level={0}
            isExpanded={expandedPaths.has(node.path)}
            onToggle={() => handleToggle(node.path)}
            onClick={() => handleNodeClick(node)}
          />
        ))}
      </div>
      {rootNodes.length === 0 && (
        <div className="p-4 text-center text-muted-foreground">
          No paths found
        </div>
      )}
    </div>
  );
}
