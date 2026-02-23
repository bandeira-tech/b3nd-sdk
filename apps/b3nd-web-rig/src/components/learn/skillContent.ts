import skillRaw from "../../../../../skills/b3nd/SKILL.md?raw";
import firecatRaw from "../../../../../skills/b3nd/FIRECAT.md?raw";
import faqRaw from "../../../../../skills/b3nd/FAQ.md?raw";
import frameworkRaw from "../../../../../skills/b3nd/FRAMEWORK.md?raw";
import operatorsRaw from "../../../../../skills/b3nd/OPERATORS.md?raw";
import appCookbookRaw from "../../../../../skills/b3nd/APP_COOKBOOK.md?raw";
import protocolCookbookRaw from "../../../../../skills/b3nd/PROTOCOL_COOKBOOK.md?raw";
import nodeCookbookRaw from "../../../../../skills/b3nd/NODE_COOKBOOK.md?raw";
import designExchangeRaw from "../../../../../skills/b3nd/DESIGN_EXCHANGE.md?raw";
import designInfraRaw from "../../../../../skills/b3nd/DESIGN_INFRASTRUCTURE.md?raw";
import designTransportRaw from "../../../../../skills/b3nd/DESIGN_TRANSPORT.md?raw";

export type LearnDocument =
  | "b3nd"
  | "firecat"
  | "faq"
  | "framework"
  | "operators"
  | "app-cookbook"
  | "protocol-cookbook"
  | "node-cookbook"
  | "design-exchange"
  | "design-infrastructure"
  | "design-transport";

export interface LearnDocEntry {
  key: LearnDocument;
  label: string;
  description: string;
  tier: "documentation" | "cookbook" | "design";
  markdown: string;
}

export const learnDocuments: LearnDocEntry[] = [
  // Documentation
  { key: "b3nd", label: "B3nd Overview", description: "What B3nd is and how it works", tier: "documentation", markdown: skillRaw },
  { key: "firecat", label: "Firecat Reference", description: "Schema, URIs, auth, visibility", tier: "documentation", markdown: firecatRaw },
  { key: "framework", label: "Framework Reference", description: "Protocol design, dispatch, primitives", tier: "documentation", markdown: frameworkRaw },
  { key: "operators", label: "Operators Guide", description: "Architecture, backends, managed mode", tier: "documentation", markdown: operatorsRaw },
  { key: "faq", label: "Design Decisions", description: "Why things work the way they do", tier: "documentation", markdown: faqRaw },
  // Cookbooks
  { key: "app-cookbook", label: "Building Firecat Apps", description: "Quick start, CRUD, browser apps, testing", tier: "cookbook", markdown: appCookbookRaw },
  { key: "protocol-cookbook", label: "Designing Protocols", description: "Worked examples, packaging SDKs", tier: "cookbook", markdown: protocolCookbookRaw },
  { key: "node-cookbook", label: "Running Nodes", description: "Deployment, Docker, monitoring", tier: "cookbook", markdown: nodeCookbookRaw },
  // Design
  { key: "design-exchange", label: "Exchange Patterns", description: "Trust models, party interactions, crypto guarantees", tier: "design", markdown: designExchangeRaw },
  { key: "design-infrastructure", label: "Infrastructure", description: "Node requirements, deployment topologies, scaling", tier: "design", markdown: designInfraRaw },
  { key: "design-transport", label: "Transport", description: "WebSocket, WebRTC, SSE, and the subscribe primitive", tier: "design", markdown: designTransportRaw },
];

export const documentationDocs = learnDocuments.filter((d) => d.tier === "documentation");
export const cookbookDocs = learnDocuments.filter((d) => d.tier === "cookbook");
export const designDocs = learnDocuments.filter((d) => d.tier === "design");

export function getDocumentMarkdown(key: LearnDocument): string {
  return learnDocuments.find((d) => d.key === key)?.markdown ?? skillRaw;
}

export function getDocEntry(key: LearnDocument): LearnDocEntry | undefined {
  return learnDocuments.find((d) => d.key === key);
}
