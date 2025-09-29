import React, { useState, useEffect } from "react";
import { useAppStore } from "../../stores/appStore";
import type { NavigationNode, PaginatedResponse } from "../../types";
import { Folder } from "lucide-react";
import { TreeNode } from "./TreeNode";

export function NavigationTree() {
  const [rootNodes, setRootNodes] = useState<NavigationNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activeBackend = useAppStore((state) =>
    state.backends.find((b) => b.id === state.activeBackendId),
  );
  const { navigateToPath, expandedPaths, togglePathExpansion } = useAppStore();

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
        const response: PaginatedResponse<NavigationNode> =
          await activeBackend.adapter.listPath("/", { page: 1, limit: 50 });
        setRootNodes(response.data);
      } catch (err) {
        setError(
          `Failed to load navigation: ${err instanceof Error ? err.message : "Unknown error"}`,
        );
      } finally {
        setLoading(false);
      }
    };

    loadRoot();
  }, [activeBackend]);

  const handleNodeClick = (node: NavigationNode) => {
    navigateToPath(node.path);
    if (node.type === "directory") {
      togglePathExpansion(node.path);
    }
  };

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
            onToggle={() => togglePathExpansion(node.path)}
            onClick={handleNodeClick}
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
