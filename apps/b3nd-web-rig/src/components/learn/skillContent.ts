// ---------------------------------------------------------------------------
// Learn catalog types — runtime data loaded from B3nd or static JSON
// ---------------------------------------------------------------------------

export interface LearnSection {
  id: string;
  title: string;
  level: number;
  children: LearnSection[];
}

export interface LearnBook {
  key: string;
  title: string;
  label: string;
  description: string;
  tier: string;
  markdown: string;
  sections: LearnSection[];
  updatedAt: number;
}

export interface LearnCatalog {
  books: LearnBook[];
  generatedAt: number;
}

// ---------------------------------------------------------------------------
// Tier configuration
// ---------------------------------------------------------------------------

export type LearnTier = "documentation" | "cookbook" | "design" | "proposals";

export interface TierConfig {
  id: LearnTier;
  label: string;
}

export const TIER_ORDER: TierConfig[] = [
  { id: "documentation", label: "Documentation" },
  { id: "cookbook", label: "Cookbooks" },
  { id: "design", label: "Design" },
  { id: "proposals", label: "Proposals" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function booksByTier(books: LearnBook[], tier: string): LearnBook[] {
  return books.filter((b) => b.tier === tier);
}

export function findBook(books: LearnBook[], key: string): LearnBook | undefined {
  return books.find((b) => b.key === key);
}
