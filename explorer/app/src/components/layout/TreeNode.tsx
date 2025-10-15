import { useState, useEffect } from "react";
import { useActiveBackend } from "../../stores/appStore";
import type { NavigationNode, PaginatedResponse } from "../../types";
import { ChevronDown, ChevronRight, Folder, FileText } from "lucide-react";
import { cn } from "../../utils";

interface TreeNodeProps {
  node: NavigationNode;
  level: number;
  isExpanded: boolean;
  onToggle: () => void;
  onClick: (node: NavigationNode) => void;
}

export function TreeNode({
  node,
  level,
  isExpanded,
  onToggle,
  onClick,
}: TreeNodeProps) {
  const [children, setChildren] = useState<NavigationNode[]>([]);
  const [loading, setLoading] = useState(false);
  const activeBackend = useActiveBackend();

  const loadChildren = async () => {
    if (
      node.type !== "directory" ||
      children.length > 0 ||
      !activeBackend?.adapter
    )
      return;

    try {
      setLoading(true);
      const response: PaginatedResponse<NavigationNode> =
        await activeBackend.adapter.listPath(node.path, { page: 1, limit: 50 });
      setChildren(response.data);
    } catch (err) {
      console.error("Failed to load children:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isExpanded) {
      loadChildren();
    } else {
      setChildren([]); // Clear on collapse to save memory
    }
  }, [isExpanded, node.path]);

  const hasChildren = children.length > 0 || (node.children && node.children.length > 0);
  const showToggle = node.type === "directory" && (hasChildren || loading);

  return (
    <div className="space-y-0.5">
      <div
        className={cn(
          "flex items-center space-x-2 cursor-pointer select-none rounded hover:bg-accent p-1",
          "focus:outline-none focus:ring-2 focus:ring-ring",
        )}
        style={{ paddingLeft: `${level * 16 + 8}px` }} // Indentation
        onClick={() => onClick(node)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick(node);
          }
          if (
            (e.key === "ArrowRight" || e.key === "ArrowDown") &&
            showToggle &&
            !isExpanded
          ) {
            e.preventDefault();
            onToggle();
          }
          if (e.key === "ArrowLeft" && showToggle && isExpanded) {
            e.preventDefault();
            onToggle();
          }
        }}
        role="treeitem"
        aria-expanded={showToggle ? isExpanded : undefined}
      >
        {showToggle ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            className="flex-shrink-0 p-0.5 rounded"
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
        ) : (
          <div className="w-6 h-6 flex-shrink-0" />
        )}
        <div className="flex-shrink-0">
          {node.type === "directory" ? (
            <Folder className="h-4 w-4 text-blue-500" />
          ) : (
            <FileText className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <span className="text-sm truncate flex-1 min-w-0">{node.name}</span>
        {loading && (
          <span className="text-xs text-muted-foreground ml-auto">
            Loading...
          </span>
        )}
      </div>
      {isExpanded && hasChildren && (
        <div className="ml-4 space-y-0.5 border-l border-gray-200 dark:border-gray-800 pl-2">
          {children.length === 0 ? (
            <div className="text-xs text-muted-foreground pl-4">
              No children
            </div>
          ) : (
            children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                level={level + 1}
                isExpanded={false} // Start collapsed
                onToggle={() => {}} // Placeholder – parent handles
                onClick={onClick} // Pass parent handler (bubbles up)
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
