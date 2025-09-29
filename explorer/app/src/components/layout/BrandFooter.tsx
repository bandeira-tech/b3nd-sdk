import React from 'react';

export function BrandFooter() {
  return (
    <footer className="brand-header h-6 flex items-center justify-between px-4 text-xs">
      {/* Left side - Status */}
      <div className="flex items-center space-x-4">
        <div className="text-brand-fg/60">b3nd/explorer</div>
        <div className="text-brand-fg/40">v1.0.0-dev</div>
      </div>

      {/* Right side - Additional info */}
      <div className="flex items-center space-x-4 text-brand-fg/40">
        <div>React 19.1.0</div>
        <div>Ready</div>
      </div>
    </footer>
  );
}
