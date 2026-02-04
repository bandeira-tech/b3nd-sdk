import { RefreshCw, ExternalLink } from "lucide-react";
import { useDashboardStore } from "../stores/dashboardStore";
import { HealthDot } from "../atoms/HealthDot";

export function HealthPanel() {
  const { services } = useDashboardStore();

  const handleRefresh = async () => {
    try {
      await fetch("http://localhost:5556/health/check", { method: "POST" });
    } catch (e) {
      console.error("Failed to refresh health:", e);
    }
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
          Service Health
        </h3>
        <button
          onClick={handleRefresh}
          className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors"
          title="Refresh health status"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-3">
        {services.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center">
            No services configured
          </div>
        ) : (
          services.map((service) => (
            <div
              key={service.id}
              className="flex items-center gap-3 p-3 bg-card border border-border rounded-lg"
            >
              <HealthDot status={service.status} />

              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{service.name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {service.url}
                </div>
              </div>

              <div className="text-right">
                {service.status === "healthy" ? (
                  <div className="text-xs text-green-500">
                    {service.latency}ms
                  </div>
                ) : service.error ? (
                  <div className="text-xs text-red-500 max-w-24 truncate" title={service.error}>
                    {service.error}
                  </div>
                ) : null}

                <a
                  href={service.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1 mt-1"
                >
                  Open <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
