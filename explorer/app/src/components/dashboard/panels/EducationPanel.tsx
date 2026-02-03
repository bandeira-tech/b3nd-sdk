import { BookOpen, Code, Lightbulb, ChevronDown, ChevronRight } from "lucide-react";
import { useState, useMemo } from "react";
import { useDashboardStore } from "../stores/dashboardStore";
import type { TestTheme } from "../types";

interface ThemeEducation {
  title: string;
  description: string;
  concepts: string[];
  codeExample: string;
}

const educationContent: Record<TestTheme, ThemeEducation> = {
  "sdk-core": {
    title: "SDK Core",
    description:
      "The core SDK provides fundamental operations for B3nd: creating clients, managing transactions, and reading/writing data through URIs.",
    concepts: [
      "URI addressing (mutable:// and immutable://)",
      "Transaction tuples [uri, data]",
      "PersistenceRecord { ts, data }",
      "Client interfaces (read, receive, list)",
    ],
    codeExample: `import { MemoryClient } from "@bandeira-tech/b3nd-sdk";

const client = new MemoryClient({ schema });

// Write data
await client.receive([
  "mutable://users/alice",
  { name: "Alice", role: "admin" }
]);

// Read data
const record = await client.read("mutable://users/alice");
console.log(record.data); // { name: "Alice", ... }`,
  },
  network: {
    title: "Network Clients",
    description:
      "HTTP and WebSocket clients enable communication with remote B3nd servers, supporting the same operations as local clients.",
    concepts: [
      "HttpClient for REST API",
      "WebSocketClient for real-time sync",
      "Connection pooling",
      "Automatic reconnection",
    ],
    codeExample: `import { HttpClient } from "@bandeira-tech/b3nd-sdk";

const client = new HttpClient({
  url: "http://localhost:9942"
});

// Same interface as MemoryClient
await client.receive(["mutable://data/key", { value: 42 }]);
const record = await client.read("mutable://data/key");`,
  },
  database: {
    title: "Database Backends",
    description:
      "PostgreSQL and MongoDB clients provide persistent storage backends with full query support and atomic transactions.",
    concepts: [
      "PostgresClient with connection pooling",
      "MongoClient with collection mapping",
      "Schema-driven table creation",
      "Transaction support",
    ],
    codeExample: `import { PostgresClient } from "@bandeira-tech/b3nd-sdk";

const client = new PostgresClient({
  connection: "postgresql://localhost/b3nd",
  tablePrefix: "b3nd",
  schema
});

await client.initializeSchema();
await client.receive(["mutable://users/bob", data]);`,
  },
  auth: {
    title: "Authentication",
    description:
      "The auth module handles wallet-based authentication, session management, and encrypted key bundles.",
    concepts: [
      "Wallet key generation",
      "Session tokens and expiry",
      "Key bundle encryption",
      "Signature verification",
    ],
    codeExample: `import { createWallet, signMessage } from "@bandeira-tech/b3nd-sdk/wallet";

const wallet = await createWallet();
const signature = await signMessage(wallet.privateKey, "Hello");

// Verify on server
const valid = await verifySignature(
  wallet.publicKey,
  "Hello",
  signature
);`,
  },
  binary: {
    title: "Binary Data",
    description:
      "Handle binary blobs efficiently with streaming support and content-addressable storage.",
    concepts: [
      "Blob URIs (blob://)",
      "Content hashing",
      "Streaming uploads",
      "Binary metadata",
    ],
    codeExample: `import { BlobClient } from "@bandeira-tech/b3nd-sdk/blob";

const blob = new Uint8Array([1, 2, 3, 4]);
const uri = await client.upload(blob, {
  contentType: "application/octet-stream"
});

const data = await client.download(uri);`,
  },
  e2e: {
    title: "End-to-End Tests",
    description:
      "Integration tests that exercise the full stack from client through server to database.",
    concepts: [
      "Full stack testing",
      "Service orchestration",
      "Data consistency verification",
      "Performance benchmarks",
    ],
    codeExample: `// E2E tests verify complete flows
Deno.test("full write-read cycle", async () => {
  // Start servers
  const server = await startTestServer();
  const client = new HttpClient({ url: server.url });

  // Test complete flow
  await client.receive([uri, data]);
  const result = await client.read(uri);
  assertEquals(result.data, data);
});`,
  },
  browser: {
    title: "Browser Clients",
    description:
      "Browser-specific clients using localStorage and IndexedDB for persistent client-side storage.",
    concepts: [
      "LocalStorageClient",
      "IndexedDBClient",
      "Offline support",
      "Sync strategies",
    ],
    codeExample: `import { IndexedDBClient } from "@bandeira-tech/b3nd-web";

const client = new IndexedDBClient({
  dbName: "my-app",
  schema
});

// Works offline
await client.receive(["mutable://local/data", value]);

// Sync when online
await client.syncWith(remoteClient);`,
  },
  other: {
    title: "Other Tests",
    description: "Miscellaneous tests covering utilities, edge cases, and specialized functionality.",
    concepts: ["Utility functions", "Edge cases", "Error handling"],
    codeExample: `// Various utility tests
Deno.test("path normalization", () => {
  assertEquals(normalizePath("//a//b/"), "/a/b");
});`,
  },
};

export function EducationPanel() {
  const { activeFacets } = useDashboardStore();
  const [expandedThemes, setExpandedThemes] = useState<Set<TestTheme>>(new Set());

  // Get active theme facets
  const activeThemes = useMemo(() => {
    const themes: TestTheme[] = [];
    for (const facetId of activeFacets) {
      if (facetId.startsWith("theme:")) {
        themes.push(facetId.replace("theme:", "") as TestTheme);
      }
    }
    return themes;
  }, [activeFacets]);

  // If specific themes are selected, show those; otherwise show a summary
  const themesToShow = activeThemes.length > 0 ? activeThemes : (Object.keys(educationContent) as TestTheme[]);

  const toggleTheme = (theme: TestTheme) => {
    setExpandedThemes((prev) => {
      const next = new Set(prev);
      if (next.has(theme)) {
        next.delete(theme);
      } else {
        next.add(theme);
      }
      return next;
    });
  };

  return (
    <div className="p-4 space-y-2">
      <div className="flex items-center gap-2 mb-4">
        <BookOpen className="w-4 h-4 text-muted-foreground" />
        <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
          Learn
        </h3>
        {activeThemes.length > 0 && (
          <span className="text-xs text-muted-foreground">
            ({activeThemes.length} selected)
          </span>
        )}
      </div>

      {themesToShow.map((themeId) => {
        const education = educationContent[themeId];
        const isExpanded = expandedThemes.has(themeId);

        return (
          <div key={themeId} className="border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => toggleTheme(themeId)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/50 transition-colors"
            >
              {isExpanded ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              )}
              <span className="font-medium text-sm">{education.title}</span>
            </button>

            {isExpanded && (
              <div className="px-3 pb-3 space-y-3 border-t border-border bg-background/50">
                <p className="text-sm text-muted-foreground pt-3">{education.description}</p>

                {/* Concepts */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Lightbulb className="w-3.5 h-3.5 text-yellow-500" />
                    <span className="text-xs font-medium">Key Concepts</span>
                  </div>
                  <ul className="space-y-1">
                    {education.concepts.map((concept: string, i: number) => (
                      <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                        <span className="text-primary">•</span>
                        {concept}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Code example */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Code className="w-3.5 h-3.5 text-blue-500" />
                    <span className="text-xs font-medium">Example</span>
                  </div>
                  <pre className="p-2 bg-muted border border-border rounded text-xs font-mono overflow-x-auto">
                    {education.codeExample}
                  </pre>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
