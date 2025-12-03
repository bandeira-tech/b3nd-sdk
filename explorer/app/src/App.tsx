import { useEffect, useState } from "react";
import { BrowserRouter as Router, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAppStore } from "./stores/appStore";
import { AppLayout } from "./components/layout/AppLayout";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import "./index.css";

// Create a query client for React Query
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function App() {
  const { theme, setTheme, backendsReady, backends } = useAppStore();
  const [isHydrating, setIsHydrating] = useState(true);

  console.log("[App] Render. backendsReady:", backendsReady, "backends.length:", backends.length, "isHydrating:", isHydrating);

  // Initialize keyboard shortcuts
  useKeyboardShortcuts();

  // Handle system theme changes
  useEffect(() => {
    if (theme === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

      const handleChange = () => {
        setTheme("system"); // Trigger theme application
      };

      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
  }, [theme, setTheme]);

  // Apply initial theme
  useEffect(() => {
    setTheme(theme);
  }, []);

  // Wait for store hydration
  useEffect(() => {
    console.log("[App:useEffect] backendsReady:", backendsReady, "backends.length:", backends.length);
    if (backendsReady) {
      console.log("[App:useEffect] Hydration complete!");
      setIsHydrating(false);
    }
  }, [backendsReady, backends.length]);

  // Show loading state while hydrating
  if (isHydrating) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg text-muted-foreground mb-4">Initializing Explorer...</div>
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto"></div>
        </div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <div className="min-h-screen bg-background text-foreground">
          <Routes>
            <Route path="/explorer/*" element={<AppLayout />} />
            <Route path="/accounts" element={<AppLayout />} />
            <Route path="/writer" element={<AppLayout />} />
            <Route path="*" element={<Navigate to="/explorer" replace />} />
          </Routes>
        </div>
      </Router>
    </QueryClientProvider>
  );
}

export default App;
