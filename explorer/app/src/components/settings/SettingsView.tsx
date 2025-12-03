import { useMemo, useState } from "react";
import { Database, Plus, Trash2, CheckCircle, Info, Shield, Server } from "lucide-react";
import { HttpAdapter } from "../../adapters/HttpAdapter";
import { useAppStore } from "../../stores/appStore";
import type { EndpointConfig } from "../../types";

export function SettingsView() {
  useAppStore();

  return (
    <>
      <BackendManager />
      <WalletManager />
      <AppServerManager />
      <AppInfo />
    </>
  );
}

export function SettingsSidePanel() {
  const {
    backends,
    activeBackendId,
    walletServers,
    activeWalletServerId,
    appServers,
    activeAppServerId,
  } = useAppStore();

  const activeBackend = useMemo(
    () => backends.find((b) => b.id === activeBackendId),
    [backends, activeBackendId],
  );
  const activeWallet = useMemo(
    () => walletServers.find((w) => w.id === activeWalletServerId && w.isActive),
    [walletServers, activeWalletServerId],
  );
  const activeApp = useMemo(
    () => appServers.find((w) => w.id === activeAppServerId && w.isActive),
    [appServers, activeAppServerId],
  );

  return (
    <aside className="w-96 border-l border-border bg-card flex flex-col">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold">Settings Summary</h3>
      </div>
      <div className="flex-1 overflow-auto custom-scrollbar p-4 space-y-4">
        <SummaryCard
          title="Backend"
          icon={<Database className="h-4 w-4" />}
          primary={activeBackend?.name || "None selected"}
          secondary={(activeBackend?.adapter as any)?.baseUrl || ""}
        />
        <SummaryCard
          title="Wallet"
          icon={<Shield className="h-4 w-4" />}
          primary={activeWallet?.name || "None selected"}
          secondary={activeWallet?.url || ""}
        />
        <SummaryCard
          title="App Server"
          icon={<Server className="h-4 w-4" />}
          primary={activeApp?.name || "None selected"}
          secondary={activeApp?.url || ""}
        />
      </div>
    </aside>
  );
}

function SummaryCard({
  title,
  icon,
  primary,
  secondary,
}: {
  title: string;
  icon: React.ReactNode;
  primary: string;
  secondary?: string;
}) {
  return (
    <div className="border border-border rounded-lg p-3 space-y-1 bg-card/80">
      <div className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        <span>{title}</span>
      </div>
      <div className="text-sm text-foreground truncate">{primary}</div>
      {secondary && <div className="text-xs text-muted-foreground truncate">{secondary}</div>}
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-border rounded-xl bg-card shadow-sm">
      <div className="px-4 py-3 border-b border-border flex items-center space-x-2">
        {icon}
        <h2 className="font-semibold">{title}</h2>
      </div>
      <div className="p-4 space-y-4">{children}</div>
    </section>
  );
}

function BackendManager() {
  const { backends, addBackend, setActiveBackend, removeBackend, activeBackendId } = useAppStore();
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({ name: "", baseUrl: "" });

  const handleAddBackend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.baseUrl.trim()) {
      return;
    }

    addBackend({
      name: formData.name,
      adapter: new HttpAdapter(formData.baseUrl),
      isActive: false,
    });

    setFormData({ name: "", baseUrl: "" });
    setShowAddForm(false);
  };

  return (
    <Section title="Explorer Backend" icon={<Database className="h-4 w-4" />}>
      <p className="text-sm text-muted-foreground">
        Configure the persistence backend shared by Explorer and Writer. Add multiple endpoints and choose one as active.
      </p>
      <div className="space-y-2 mb-4">
        {backends.map((backend) => (
          <EndpointItem
            key={backend.id}
            item={{
              id: backend.id,
              name: backend.name,
              url: (backend.adapter as any).baseUrl || "",
              isActive: backend.isActive,
            }}
            onActivate={() => setActiveBackend(backend.id)}
            onRemove={() => removeBackend(backend.id)}
            activeId={activeBackendId}
          />
        ))}
      </div>

      {showAddForm ? (
        <EndpointForm
          formData={formData}
          setFormData={setFormData}
          onSubmit={handleAddBackend}
          onCancel={() => {
            setShowAddForm(false);
            setFormData({ name: "", baseUrl: "" });
          }}
          placeholder="http://localhost:8842"
          cta="Add backend"
        />
      ) : (
        <AddButton onClick={() => setShowAddForm(true)} label="Add Backend" />
      )}
    </Section>
  );
}

function WalletManager() {
  const { walletServers, activeWalletServerId, addWalletServer, removeWalletServer, setActiveWalletServer } = useAppStore();
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({ name: "", baseUrl: "" });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.baseUrl.trim()) return;
    addWalletServer({ name: formData.name, url: formData.baseUrl, isActive: false });
    setFormData({ name: "", baseUrl: "" });
    setShowAddForm(false);
  };

  return (
    <Section title="Wallet Servers" icon={<Shield className="h-4 w-4" />}>
      <p className="text-sm text-muted-foreground">Configure wallet servers used for auth and proxy operations.</p>
      <div className="space-y-2 mb-4">
        {walletServers.map((server) => (
          <EndpointItem
            key={server.id}
            item={server}
            onActivate={() => setActiveWalletServer(server.id)}
            onRemove={() => removeWalletServer(server.id)}
            activeId={activeWalletServerId}
          />
        ))}
      </div>
      {showAddForm ? (
        <EndpointForm
          formData={formData}
          setFormData={setFormData}
          onSubmit={handleAdd}
          onCancel={() => {
            setShowAddForm(false);
            setFormData({ name: "", baseUrl: "" });
          }}
          placeholder="http://localhost:3001"
          cta="Add wallet server"
        />
      ) : (
        <AddButton onClick={() => setShowAddForm(true)} label="Add Wallet Server" />
      )}
    </Section>
  );
}

function AppServerManager() {
  const { appServers, activeAppServerId, addAppServer, removeAppServer, setActiveAppServer } = useAppStore();
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({ name: "", baseUrl: "" });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.baseUrl.trim()) return;
    addAppServer({ name: formData.name, url: formData.baseUrl, isActive: false });
    setFormData({ name: "", baseUrl: "" });
    setShowAddForm(false);
  };

  return (
    <Section title="App Servers" icon={<Server className="h-4 w-4" />}>
      <p className="text-sm text-muted-foreground">Configure app servers for actions and schemas.</p>
      <div className="space-y-2 mb-4">
        {appServers.map((server) => (
          <EndpointItem
            key={server.id}
            item={server}
            onActivate={() => setActiveAppServer(server.id)}
            onRemove={() => removeAppServer(server.id)}
            activeId={activeAppServerId}
          />
        ))}
      </div>
      {showAddForm ? (
        <EndpointForm
          formData={formData}
          setFormData={setFormData}
          onSubmit={handleAdd}
          onCancel={() => {
            setShowAddForm(false);
            setFormData({ name: "", baseUrl: "" });
          }}
          placeholder="http://localhost:3003"
          cta="Add app server"
        />
      ) : (
        <AddButton onClick={() => setShowAddForm(true)} label="Add App Server" />
      )}
    </Section>
  );
}

function AppInfo() {
  return (
    <Section title="Application Info" icon={<Info className="h-4 w-4" />}>
      <div className="space-y-3 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Version:</span>
          <span>1.0.0-dev</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">React:</span>
          <span>19.1.0</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Mode:</span>
          <span className="font-mono">development</span>
        </div>
      </div>
    </Section>
  );
}

function EndpointItem({
  item,
  onActivate,
  onRemove,
  activeId,
}: {
  item: EndpointConfig;
  onActivate: () => void;
  onRemove: () => void;
  activeId: string | null;
}) {
  const isActive = item.id === activeId;
  return (
    <div
      className={`flex items-center justify-between p-3 rounded border transition-colors ${
        isActive ? "border-primary bg-primary/5" : "border-border hover:bg-accent"
      }`}
    >
      <div className="flex items-center space-x-3 min-w-0 flex-1">
        <div className="flex items-center space-x-2">
          {isActive ? (
            <CheckCircle className="h-4 w-4 text-primary" />
          ) : (
            <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/30" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm truncate">{item.name}</div>
          <div className="text-xs text-muted-foreground truncate">{item.url}</div>
        </div>
      </div>
      <div className="flex items-center space-x-1 flex-shrink-0">
        {!isActive && (
          <>
            <button
              onClick={onActivate}
              className="p-1 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
              title="Set active"
            >
              <CheckCircle className="h-3 w-3" />
            </button>
            <button
              onClick={onRemove}
              className="p-1 rounded hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
              title="Remove"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function EndpointForm({
  formData,
  setFormData,
  onSubmit,
  onCancel,
  placeholder,
  cta,
}: {
  formData: { name: string; baseUrl: string };
  setFormData: (v: { name: string; baseUrl: string }) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  placeholder: string;
  cta: string;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-3 p-3 border border-border rounded-lg bg-muted/20">
      <div className="space-y-1">
        <label className="block text-sm font-medium">Name</label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          className="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          autoFocus
        />
      </div>
      <div className="space-y-1">
        <label className="block text-sm font-medium">Base URL</label>
        <input
          type="text"
          value={formData.baseUrl}
          onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
          placeholder={placeholder}
          className="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <div className="flex space-x-2">
        <button
          type="submit"
          className="flex-1 px-3 py-2 bg-primary text-primary-foreground rounded text-sm hover:bg-primary/90 transition-colors"
        >
          {cta}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 px-3 py-2 bg-muted text-foreground rounded text-sm hover:bg-muted/80 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="w-full p-2 border border-dashed border-border rounded-lg hover:bg-accent transition-colors flex items-center justify-center space-x-2 text-muted-foreground hover:text-foreground"
    >
      <Plus className="h-4 w-4" />
      <span className="text-sm">{label}</span>
    </button>
  );
}
