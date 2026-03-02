// ---------------------------------------------------------------------------
// Learn catalog types — runtime data loaded from B3nd or static JSON
// ---------------------------------------------------------------------------

export interface LearnSection {
  id: string;
  title: string;
  level: number;
  children: LearnSection[];
}

/** Metadata for one chapter inside a multi-chapter book (no markdown). */
export interface LearnChapterMeta {
  key: string;
  number: number;
  title: string;
  part: string;
  sections: LearnSection[];
  uri: string;
}

/** Full chapter content, loaded on demand. */
export interface LearnChapter extends LearnChapterMeta {
  markdown: string;
}

export interface LearnBook {
  key: string;
  title: string;
  label: string;
  description: string;
  tier: string;

  /** Full markdown — present for single-file books, absent for chapter-based. */
  markdown?: string;
  sections: LearnSection[];

  /** Chapter index — present for multi-chapter books. */
  chapters?: LearnChapterMeta[];

  updatedAt: number;
}

export interface LearnCatalog {
  books: LearnBook[];
  generatedAt: number;
}

/** Type guard: does this book have chapters (multi-file)? */
export function isChapterBook(book: LearnBook): book is LearnBook & { chapters: LearnChapterMeta[] } {
  return Array.isArray(book.chapters) && book.chapters.length > 0;
}

// ---------------------------------------------------------------------------
// Tier configuration
// ---------------------------------------------------------------------------

export type LearnTier = "guide" | "documentation" | "cookbook" | "design" | "proposals";

export interface TierConfig {
  id: LearnTier;
  label: string;
}

export const TIER_ORDER: TierConfig[] = [
  { id: "guide", label: "Guides" },
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
