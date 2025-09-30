import React, { useState, useEffect, useCallback } from "react";
import { useAppStore } from "../../stores/appStore";
import type { NavigationNode, PaginatedResponse } from "../../types";
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
  const { navigateToPath, expandedPaths, togglePathExpansion, loadSchemas } = useAppStore();

  useEffect(() => {
    if (!activeBackend?.adapter) {
      setError("No active backend");
      setLoading(false);
      return;
    }

    const loadRoot = async () => {
      try {
        setLoading(true);
        setError(null);

        // Load schemas if not already loaded
        if (schemas.length === 0) {
          await loadSchemas();
        }
      } catch (err) {
        setError(
          `Failed to load navigation: ${err instanceof Error ? err.message : "Unknown error"}`,
        );
      } finally {
        setLoading(false);
      }
    };

    loadRoot();
  }, [activeBackend, loadSchemas]);

  const handleToggle = useCallback(
    (path: string) => {
      console.log("Toggled path:", path); // Temp debug – remove later
      togglePathExpansion(path);
    },
    [togglePathExpansion],
  );

  const handleNodeClick = useCallback(
    (node: NavigationNode) => {
      console.log("Clicked node:", node.path); // Temp debug – remove later
      navigateToPath(node.path);
      if (node.type === "directory") {
        handleToggle(node.path);
      }
    },
    [navigateToPath, handleToggle],
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
