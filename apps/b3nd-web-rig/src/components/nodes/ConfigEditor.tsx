import { useCallback, useEffect, useState } from "react";
import { Code, FormInput, Loader2, Plus, Send, Trash2, X } from "lucide-react";
import { cn } from "../../utils";
import {
  useNodesStore,
  type BackendSpec,
  type ManagedNodeConfig,
  type NetworkNodeEntry,
} from "./stores/nodesStore";

interface Props {
  entry: NetworkNodeEntry;
  networkId: string;
}

export function ConfigEditor({ entry, networkId }: Props) {
  const {
    configDrafts,
    configEditorMode,
    pushingConfig,
    pushError,
    setConfigDraft,
    clearConfigDraft,
    setConfigEditorMode,
    setPushingConfig,
    setPushError,
  } = useNodesStore();

  const draft = configDrafts[entry.nodeId] ?? entry.config;
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Sync JSON text when switching to JSON mode or when draft changes
  useEffect(() => {
    if (configEditorMode === "json") {
      setJsonText(JSON.stringify(draft, null, 2));
      setJsonError(null);
    }
  }, [configEditorMode, entry.nodeId]);

  const updateDraft = useCallback(
    (updater: (config: ManagedNodeConfig) => ManagedNodeConfig) => {
      setConfigDraft(entry.nodeId, updater(draft));
    },
    [draft, entry.nodeId, setConfigDraft]
  );

  const handleJsonChange = (text: string) => {
    setJsonText(text);
    try {
      const parsed = JSON.parse(text);
      setJsonError(null);
      setConfigDraft(entry.nodeId, parsed);
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : "Invalid JSON");
    }
  };

  const handlePushConfig = async () => {
    setPushingConfig(true);
    setPushError(null);

    try {
      // The actual push would sign + write to B3nd via the active backend
      // For now, just update the network entry
      const { addNodeToNetwork, removeNodeFromNetwork } = useNodesStore.getState();
      removeNodeFromNetwork(networkId, entry.nodeId);
      addNodeToNetwork(networkId, { ...entry, config: draft });
      clearConfigDraft(entry.nodeId);
      console.log("[nodes] Config pushed for", entry.nodeId);
    } catch (e) {
      setPushError(e instanceof Error ? e.message : "Push failed");
    } finally {
      setPushingConfig(false);
    }
  };

  const isDirty = configDrafts[entry.nodeId] !== undefined;

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setConfigEditorMode("form")}
            className={cn(
              "flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors",
              configEditorMode === "form"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <FormInput className="w-3 h-3" />
            Form
          </button>
          <button
            onClick={() => setConfigEditorMode("json")}
            className={cn(
              "flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors",
              configEditorMode === "json"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Code className="w-3 h-3" />
            JSON
          </button>
        </div>

        <div className="flex items-center gap-2">
          {isDirty && (
            <button
              onClick={() => clearConfigDraft(entry.nodeId)}
              className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground rounded transition-colors"
            >
              <X className="w-3 h-3" />
              Discard
            </button>
          )}
          <button
            onClick={handlePushConfig}
            disabled={pushingConfig || !!jsonError}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors",
              isDirty
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-muted-foreground"
            )}
          >
            {pushingConfig ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Send className="w-3 h-3" />
            )}
            Push Config
          </button>
        </div>
      </div>

      {/* Error banner */}
      {pushError && (
        <div className="px-4 py-2 text-xs bg-red-500/10 text-red-600 border-b border-red-500/20">
          {pushError}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {configEditorMode === "form" ? (
          <FormMode draft={draft} updateDraft={updateDraft} />
        ) : (
          <JsonMode
            jsonText={jsonText}
            jsonError={jsonError}
            onChange={handleJsonChange}
          />
        )}
      </div>
    </div>
  );
}

// ── Form Mode ─────────────────────────────────────────────────────────

function FormMode({
  draft,
  updateDraft,
}: {
  draft: ManagedNodeConfig;
  updateDraft: (fn: (c: ManagedNodeConfig) => ManagedNodeConfig) => void;
}) {
  return (
    <div className="space-y-6 max-w-2xl">
      {/* General */}
      <Section title="General">
        <Field label="Node Name">
          <input
            type="text"
            value={draft.name}
            onChange={(e) =>
              updateDraft((c) => ({ ...c, name: e.target.value }))
            }
            className="field-input"
          />
        </Field>
        <Field label="Node ID">
          <input
            type="text"
            value={draft.nodeId}
            readOnly
            className="field-input bg-muted"
          />
        </Field>
      </Section>

      {/* Server */}
      <Section title="Server">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Port">
            <input
              type="number"
              value={draft.server.port}
              onChange={(e) =>
                updateDraft((c) => ({
                  ...c,
                  server: { ...c.server, port: Number(e.target.value) },
                }))
              }
              className="field-input"
            />
          </Field>
          <Field label="CORS Origin">
            <input
              type="text"
              value={draft.server.corsOrigin}
              onChange={(e) =>
                updateDraft((c) => ({
                  ...c,
                  server: { ...c.server, corsOrigin: e.target.value },
                }))
              }
              className="field-input"
            />
          </Field>
        </div>
      </Section>

      {/* Backends */}
      <Section title="Backends">
        {draft.backends.map((backend, i) => (
          <BackendRow
            key={i}
            backend={backend}
            onChange={(updated) =>
              updateDraft((c) => ({
                ...c,
                backends: c.backends.map((b, j) => (j === i ? updated : b)),
              }))
            }
            onRemove={() =>
              updateDraft((c) => ({
                ...c,
                backends: c.backends.filter((_, j) => j !== i),
              }))
            }
          />
        ))}
        <button
          onClick={() =>
            updateDraft((c) => ({
              ...c,
              backends: [...c.backends, { type: "memory", url: "memory://" }],
            }))
          }
          className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 mt-2"
        >
          <Plus className="w-3 h-3" />
          Add backend
        </button>
      </Section>

      {/* Schema */}
      <Section title="Schema">
        <Field label="Schema Module URL">
          <input
            type="text"
            value={draft.schemaModuleUrl ?? ""}
            onChange={(e) =>
              updateDraft((c) => ({
                ...c,
                schemaModuleUrl: e.target.value || undefined,
              }))
            }
            placeholder="https://example.com/schema.ts"
            className="field-input"
          />
        </Field>
      </Section>

      {/* Monitoring */}
      <Section title="Monitoring">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Heartbeat Interval (ms)">
            <input
              type="number"
              value={draft.monitoring.heartbeatIntervalMs}
              onChange={(e) =>
                updateDraft((c) => ({
                  ...c,
                  monitoring: {
                    ...c.monitoring,
                    heartbeatIntervalMs: Number(e.target.value),
                  },
                }))
              }
              className="field-input"
            />
          </Field>
          <Field label="Config Poll Interval (ms)">
            <input
              type="number"
              value={draft.monitoring.configPollIntervalMs}
              onChange={(e) =>
                updateDraft((c) => ({
                  ...c,
                  monitoring: {
                    ...c.monitoring,
                    configPollIntervalMs: Number(e.target.value),
                  },
                }))
              }
              className="field-input"
            />
          </Field>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <input
            type="checkbox"
            id="metricsEnabled"
            checked={draft.monitoring.metricsEnabled}
            onChange={(e) =>
              updateDraft((c) => ({
                ...c,
                monitoring: {
                  ...c.monitoring,
                  metricsEnabled: e.target.checked,
                },
              }))
            }
            className="rounded border-border"
          />
          <label htmlFor="metricsEnabled" className="text-xs">
            Enable metrics collection
          </label>
        </div>
      </Section>

      {/* Tags */}
      <Section title="Tags">
        <TagsEditor
          tags={draft.tags ?? {}}
          onChange={(tags) => updateDraft((c) => ({ ...c, tags }))}
        />
      </Section>
    </div>
  );
}

// ── JSON Mode ─────────────────────────────────────────────────────────

function JsonMode({
  jsonText,
  jsonError,
  onChange,
}: {
  jsonText: string;
  jsonError: string | null;
  onChange: (text: string) => void;
}) {
  return (
    <div className="h-full flex flex-col">
      {jsonError && (
        <div className="px-3 py-1.5 text-xs bg-red-500/10 text-red-600 rounded-t border border-red-500/20">
          {jsonError}
        </div>
      )}
      <textarea
        value={jsonText}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "flex-1 w-full font-mono text-xs p-4 bg-muted/30 border border-border rounded-lg resize-none",
          "focus:outline-none focus:ring-1 focus:ring-primary",
          jsonError && "rounded-t-none border-t-0"
        )}
        spellCheck={false}
      />
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-medium mb-3">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground mb-1 block">{label}</label>
      {children}
    </div>
  );
}

function BackendRow({
  backend,
  onChange,
  onRemove,
}: {
  backend: BackendSpec;
  onChange: (b: BackendSpec) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2 p-2 rounded border border-border bg-muted/20">
      <select
        value={backend.type}
        onChange={(e) =>
          onChange({ ...backend, type: e.target.value as BackendSpec["type"] })
        }
        className="px-2 py-1.5 text-xs bg-background border border-border rounded"
      >
        <option value="memory">Memory</option>
        <option value="postgresql">PostgreSQL</option>
        <option value="mongodb">MongoDB</option>
        <option value="http">HTTP</option>
      </select>
      <input
        type="text"
        value={backend.url}
        onChange={(e) => onChange({ ...backend, url: e.target.value })}
        placeholder="URL..."
        className="flex-1 field-input"
      />
      <button
        onClick={onRemove}
        className="p-1 text-muted-foreground hover:text-red-500 transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function TagsEditor({
  tags,
  onChange,
}: {
  tags: Record<string, string>;
  onChange: (tags: Record<string, string>) => void;
}) {
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");

  const addTag = () => {
    if (!newKey.trim()) return;
    onChange({ ...tags, [newKey.trim()]: newVal });
    setNewKey("");
    setNewVal("");
  };

  return (
    <div className="space-y-2">
      {Object.entries(tags).map(([k, v]) => (
        <div key={k} className="flex items-center gap-2">
          <span className="text-xs font-mono bg-muted px-2 py-1 rounded">{k}</span>
          <span className="text-xs">=</span>
          <input
            type="text"
            value={v}
            onChange={(e) => onChange({ ...tags, [k]: e.target.value })}
            className="flex-1 field-input"
          />
          <button
            onClick={() => {
              const { [k]: _, ...rest } = tags;
              onChange(rest);
            }}
            className="p-1 text-muted-foreground hover:text-red-500"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTag()}
          placeholder="key"
          className="w-24 field-input"
        />
        <span className="text-xs">=</span>
        <input
          type="text"
          value={newVal}
          onChange={(e) => setNewVal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTag()}
          placeholder="value"
          className="flex-1 field-input"
        />
        <button
          onClick={addTag}
          className="p-1 text-muted-foreground hover:text-primary"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
