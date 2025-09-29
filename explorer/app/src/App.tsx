import React, { useEffect } from "react";
import { BrowserRouter as Router } from "react-router-dom";
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
  const { theme, setTheme } = useAppStore();

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

  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <div className="min-h-screen bg-background text-foreground">
          <AppLayout />
        </div>
      </Router>
    </QueryClientProvider>
  );
}

export default App;
