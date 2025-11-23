// React import not needed with react-jsx runtime
import { useState } from 'react';
import { useAppStore, useActiveBackend } from '../../stores/appStore';
import { Settings, Database, Plus, Trash2, CheckCircle, Info, X } from 'lucide-react';
import { cn } from '../../utils';
import { HttpAdapter } from '../../adapters/HttpAdapter';

export function RightPanel() {
  const { togglePanel } = useAppStore();

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
          Settings & Info
        </h2>
        <button
          onClick={() => togglePanel('right')}
          className="p-1 rounded hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
          title="Close panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        <div className="space-y-6">
          <BackendManager />
          <ApplicationInfo />
          <KeyboardShortcuts />
        </div>
      </div>
    </div>
  );
}

function BackendManager() {
  const { backends, addBackend } = useAppStore();
  const activeBackend = useActiveBackend();
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    baseUrl: '',
  });

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

    // Reset form
    setFormData({ name: '', baseUrl: '' });
    setShowAddForm(false);
  };

  return (
    <div className="p-4 border-b border-border">
      <div className="flex items-center space-x-2 mb-4">
        <Database className="h-4 w-4" />
        <h3 className="font-semibold">Backend Configuration</h3>
      </div>

      {/* Active Backend Status */}
      {activeBackend && (
        <div className="mb-4 p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium text-sm">{activeBackend.name}</span>
            <div className="flex items-center space-x-1">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-sm text-muted-foreground">Active</span>
            </div>
          </div>
          <div className="text-sm text-muted-foreground">
            Type: {activeBackend.adapter.type}
          </div>
          {activeBackend.adapter.baseUrl && (
            <div className="text-sm text-muted-foreground truncate">
              URL: {activeBackend.adapter.baseUrl}
            </div>
          )}
        </div>
      )}

      {/* Backend List */}
      <div className="space-y-2 mb-4">
        {backends.map((backend) => (
          <BackendItem key={backend.id} backend={backend} />
        ))}
      </div>

      {/* Add Backend Form */}
      {showAddForm ? (
        <form onSubmit={handleAddBackend} className="space-y-3 p-3 border border-border rounded-lg bg-muted/20">
          <div>
            <label className="block text-sm font-medium mb-1">Backend Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="My Backend"
              className="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Base URL</label>
            <input
              type="text"
              value={formData.baseUrl}
              onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
              placeholder="http://localhost:8842"
              className="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex space-x-2">
            <button
              type="submit"
              className="flex-1 px-3 py-2 bg-primary text-primary-foreground rounded text-sm hover:bg-primary/90 transition-colors"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAddForm(false);
                setFormData({ name: '', baseUrl: '' });
              }}
              className="flex-1 px-3 py-2 bg-muted text-foreground rounded text-sm hover:bg-muted/80 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className="w-full p-2 border border-dashed border-border rounded-lg hover:bg-accent transition-colors flex items-center justify-center space-x-2 text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
          <span className="text-sm">Add Backend</span>
        </button>
      )}
    </div>
  );
}

function BackendItem({ backend }: { backend: any }) {
  const { setActiveBackend, removeBackend, activeBackendId } = useAppStore();
  const isActive = backend.id === activeBackendId;

  return (
    <div className={cn(
      "flex items-center justify-between p-2 rounded border transition-colors",
      isActive ? "border-primary bg-primary/5" : "border-border hover:bg-accent"
    )}>
      <div className="flex items-center space-x-3 min-w-0 flex-1">
        <div className="flex items-center space-x-2">
          {isActive ? (
            <CheckCircle className="h-4 w-4 text-primary" />
          ) : (
            <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/30" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm truncate">{backend.name}</div>
          <div className="text-xs text-muted-foreground">{backend.adapter.type}</div>
        </div>
      </div>

      <div className="flex items-center space-x-1 flex-shrink-0">
        {!isActive && (
          <>
            <button
              onClick={() => setActiveBackend(backend.id)}
              className="p-1 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
              title="Set as active backend"
            >
              <CheckCircle className="h-3 w-3" />
            </button>
            <button
              onClick={() => removeBackend(backend.id)}
              className="p-1 rounded hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
              title="Remove backend"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ApplicationInfo() {
  return (
    <div className="p-4 border-b border-border">
      <div className="flex items-center space-x-2 mb-4">
        <Info className="h-4 w-4" />
        <h3 className="font-semibold">Application Info</h3>
      </div>

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
    </div>
  );
}

function KeyboardShortcuts() {
  const shortcuts = [
    { keys: ['Ctrl', 'B'], description: 'Toggle left panel' },
    { keys: ['Ctrl', 'Shift', 'B'], description: 'Toggle bottom panel' },
    { keys: ['Ctrl', 'Shift', 'R'], description: 'Toggle right panel' },
    { keys: ['Ctrl', 'K'], description: 'Quick search' },
    { keys: ['Escape'], description: 'Close modals/clear search' },
    { keys: ['Tab'], description: 'Navigate focus' },
    { keys: ['Enter', 'Space'], description: 'Activate item' },
    { keys: ['Arrow Keys'], description: 'Navigate lists' },
  ];

  return (
    <div className="p-4">
      <div className="flex items-center space-x-2 mb-4">
        <Settings className="h-4 w-4" />
        <h3 className="font-semibold">Keyboard Shortcuts</h3>
      </div>

      <div className="space-y-2">
        {shortcuts.map(({ keys, description }, index) => (
          <div key={index} className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">{description}</span>
            <div className="flex space-x-1">
              {keys.map((key, keyIndex) => (
                <kbd
                  key={keyIndex}
                  className="px-2 py-1 bg-muted rounded text-xs font-mono border border-border"
                >
                  {key}
                </kbd>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
