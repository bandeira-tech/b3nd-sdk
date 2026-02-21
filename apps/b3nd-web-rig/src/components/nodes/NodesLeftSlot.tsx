import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleDot,
  KeyRound,
  Loader2,
  Network,
  Plus,
  Server,
} from "lucide-react";
import { cn } from "../../utils";
import {
  createDefaultConfig,
  useNodesStore,
  type NetworkManifest,
  type NetworkNodeEntry,
} from "./stores/nodesStore";

export function NodesLeftSlot() {
  const {
    networks,
    activeNetworkId,
    activeNodeId,
    nodeStatuses,
    setActiveNetwork,
    setActiveNode,
    addNetwork,
    addNodeToNetwork,
  } = useNodesStore();

  const [expandedNetworks, setExpandedNetworks] = useState<Set<string>>(
    new Set()
  );
  const [showNewNetwork, setShowNewNetwork] = useState(false);
  const [newNetworkName, setNewNetworkName] = useState("");
  const [addingNodeTo, setAddingNodeTo] = useState<string | null>(null);
  const [nodeKeyInput, setNodeKeyInput] = useState("");
  const [generating, setGenerating] = useState(false);

  const toggleExpand = (networkId: string) => {
    setExpandedNetworks((prev) => {
      const next = new Set(prev);
      if (next.has(networkId)) next.delete(networkId);
      else next.add(networkId);
      return next;
    });
  };

  const handleCreateNetwork = () => {
    if (!newNetworkName.trim()) return;
    const networkId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const manifest: NetworkManifest = {
      networkId,
      name: newNetworkName.trim(),
      nodes: [],
    };
    addNetwork(manifest);
    setActiveNetwork(networkId);
    setExpandedNetworks((prev) => new Set([...prev, networkId]));
    setNewNetworkName("");
    setShowNewNetwork(false);
  };

  const handleAddNodeWithKey = (networkId: string, pubKeyHex: string, entry?: Partial<NetworkNodeEntry>) => {
    const name = `node-${pubKeyHex.slice(0, 8)}`;
    addNodeToNetwork(networkId, {
      nodeId: pubKeyHex,
      name,
      role: "replica",
      config: createDefaultConfig(pubKeyHex, name),
      ...entry,
    });
    setActiveNode(pubKeyHex);
    setAddingNodeTo(null);
    setNodeKeyInput("");
  };

  const handleGenerateKeypair = async (networkId: string) => {
    setGenerating(true);
    try {
      // Generate Ed25519 signing keypair
      const signingPair = await crypto.subtle.generateKey(
        { name: "Ed25519", namedCurve: "Ed25519" } as any,
        true,
        ["sign", "verify"],
      ) as CryptoKeyPair;
      const pubBytes = new Uint8Array(await crypto.subtle.exportKey("raw", signingPair.publicKey));
      const pubHex = Array.from(pubBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
      const privDer = new Uint8Array(await crypto.subtle.exportKey("pkcs8", signingPair.privateKey));
      const privB64 = btoa(String.fromCharCode(...privDer));
      const privPem = `-----BEGIN PRIVATE KEY-----\n${privB64.match(/.{1,64}/g)?.join("\n")}\n-----END PRIVATE KEY-----`;

      // Generate X25519 encryption keypair
      const encPair = await crypto.subtle.generateKey(
        { name: "X25519", namedCurve: "X25519" } as any,
        true,
        ["deriveBits"],
      ) as CryptoKeyPair;
      const encPubBytes = new Uint8Array(await crypto.subtle.exportKey("raw", encPair.publicKey));
      const encPubHex = Array.from(encPubBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
      const encPrivBytes = new Uint8Array(await crypto.subtle.exportKey("pkcs8", encPair.privateKey));
      const encPrivHex = Array.from(encPrivBytes).map((b) => b.toString(16).padStart(2, "0")).join("");

      handleAddNodeWithKey(networkId, pubHex, {
        encryptionPublicKeyHex: encPubHex,
        generatedKeys: {
          privateKeyPem: privPem,
          encryptionPrivateKeyHex: encPrivHex,
          encryptionPublicKeyHex: encPubHex,
        },
      });
    } catch (e) {
      console.error("[nodes] Keygen failed:", e);
    } finally {
      setGenerating(false);
    }
  };

  const statusColor = (nodeId: string) => {
    const s = nodeStatuses[nodeId];
    if (!s) return "text-muted-foreground";
    if (s.status === "online") return "text-green-500";
    if (s.status === "degraded") return "text-yellow-500";
    return "text-red-500";
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-border bg-card flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">Networks</span>
        </div>
        <button
          onClick={() => setShowNewNetwork(true)}
          className="p-1 rounded hover:bg-accent transition-colors"
          title="Create network"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* New network input */}
      {showNewNetwork && (
        <div className="p-2 border-b border-border">
          <input
            type="text"
            value={newNetworkName}
            onChange={(e) => setNewNetworkName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateNetwork();
              if (e.key === "Escape") setShowNewNetwork(false);
            }}
            placeholder="Network name..."
            className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
            autoFocus
          />
        </div>
      )}

      {/* Network tree */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        {networks.length === 0 && (
          <div className="p-4 text-xs text-muted-foreground text-center">
            No networks yet. Click + to create one.
          </div>
        )}

        {networks.map((network) => {
          const isExpanded = expandedNetworks.has(network.networkId);
          const isActive = activeNetworkId === network.networkId;

          return (
            <div key={network.networkId}>
              {/* Network row */}
              <button
                onClick={() => {
                  setActiveNetwork(network.networkId);
                  toggleExpand(network.networkId);
                }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50"
                )}
              >
                {isExpanded ? (
                  <ChevronDown className="w-3 h-3 shrink-0" />
                ) : (
                  <ChevronRight className="w-3 h-3 shrink-0" />
                )}
                <Network className="w-3.5 h-3.5 shrink-0 text-primary" />
                <span className="truncate font-medium">{network.name}</span>
                <span className="ml-auto text-muted-foreground">
                  {network.nodes.length}
                </span>
              </button>

              {/* Node list */}
              {isExpanded && (
                <div>
                  {network.nodes.map((entry) => (
                    <button
                      key={entry.nodeId}
                      onClick={() => {
                        setActiveNetwork(network.networkId);
                        setActiveNode(entry.nodeId);
                      }}
                      className={cn(
                        "w-full flex items-center gap-2 pl-8 pr-3 py-1.5 text-xs transition-colors",
                        activeNodeId === entry.nodeId
                          ? "bg-primary/10 text-primary"
                          : "hover:bg-accent/50 text-foreground"
                      )}
                    >
                      <CircleDot
                        className={cn("w-3 h-3 shrink-0", statusColor(entry.nodeId))}
                      />
                      <Server className="w-3 h-3 shrink-0" />
                      <span className="truncate">{entry.name}</span>
                      <span className="ml-auto text-muted-foreground text-[10px]">
                        {entry.role}
                      </span>
                    </button>
                  ))}

                  {/* Add node form */}
                  {addingNodeTo === network.networkId ? (
                    <div className="pl-8 pr-3 py-2 space-y-2">
                      <input
                        type="text"
                        value={nodeKeyInput}
                        onChange={(e) => setNodeKeyInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && nodeKeyInput.trim()) {
                            handleAddNodeWithKey(network.networkId, nodeKeyInput.trim());
                          }
                          if (e.key === "Escape") {
                            setAddingNodeTo(null);
                            setNodeKeyInput("");
                          }
                        }}
                        placeholder="Paste public key hex..."
                        className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                        autoFocus
                      />
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => {
                            if (nodeKeyInput.trim()) {
                              handleAddNodeWithKey(network.networkId, nodeKeyInput.trim());
                            }
                          }}
                          disabled={!nodeKeyInput.trim()}
                          className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                        >
                          <Plus className="w-3 h-3" />
                          Add
                        </button>
                        <button
                          onClick={() => handleGenerateKeypair(network.networkId)}
                          disabled={generating}
                          className="flex items-center gap-1 px-2 py-1 text-[10px] rounded border border-border hover:bg-accent transition-colors"
                        >
                          {generating ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <KeyRound className="w-3 h-3" />
                          )}
                          Generate
                        </button>
                        <button
                          onClick={() => {
                            setAddingNodeTo(null);
                            setNodeKeyInput("");
                          }}
                          className="ml-auto text-[10px] text-muted-foreground hover:text-foreground"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setAddingNodeTo(network.networkId)}
                      className="w-full flex items-center gap-2 pl-8 pr-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Add node</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
