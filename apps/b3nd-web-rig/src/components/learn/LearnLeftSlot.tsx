import { useState } from "react";
import { ArrowLeft, BookOpen, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../../utils";
import {
  TIER_ORDER, booksByTier, findBook, isChapterBook,
  type LearnCatalog, type LearnSection, type LearnChapterMeta,
} from "./skillContent";
import { useLearnStore } from "./useLearnStore";
import { useRead } from "./useRead";

const CATALOG_URI = "mutable://open/rig/learn/catalog";

export function LearnLeftSlot() {
  const activeBook = useLearnStore((s) => s.activeBook);
  const { data: catalog } = useRead<LearnCatalog>(CATALOG_URI);

  if (!catalog) return null;
  if (!activeBook) return <IndexMode catalog={catalog} />;

  const book = findBook(catalog.books, activeBook);
  if (!book) return null;

  if (isChapterBook(book)) return <ChapterReaderMode book={book} />;
  return <SingleFileReaderMode book={book} />;
}

/* -- Index Mode ---------------------------------------------------------- */

function IndexMode({ catalog }: { catalog: LearnCatalog }) {
  const openBook = useLearnStore((s) => s.openBook);

  const [expandedTiers, setExpandedTiers] = useState<Set<string>>(
    () => new Set(TIER_ORDER.map((t) => t.label)),
  );

  const toggleTier = (label: string) => {
    setExpandedTiers((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-border bg-card flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium">Learn</span>
      </div>

      <div className="flex-1 overflow-auto custom-scrollbar py-1">
        {TIER_ORDER.map((tier) => {
          const tierBooks = booksByTier(catalog.books, tier.id);
          if (tierBooks.length === 0) return null;

          return (
            <CollapsibleGroup
              key={tier.id}
              label={tier.label}
              expanded={expandedTiers.has(tier.label)}
              onToggle={() => toggleTier(tier.label)}
            >
              {tierBooks.map((book) => (
                <button
                  key={book.key}
                  onClick={() => openBook(book.key)}
                  className="w-full flex flex-col gap-0.5 pl-8 pr-3 py-2 text-left hover:bg-accent/50 transition-colors"
                >
                  <span className="text-xs font-medium text-foreground truncate">{book.label}</span>
                  <span className="text-[10px] text-muted-foreground truncate">{book.description}</span>
                </button>
              ))}
            </CollapsibleGroup>
          );
        })}
      </div>
    </div>
  );
}

/* -- Single-file Reader Mode --------------------------------------------- */

function SingleFileReaderMode({ book }: { book: { key: string; label: string; sections: LearnSection[] } }) {
  const closeBook = useLearnStore((s) => s.closeBook);
  const activeSectionId = useLearnStore((s) => s.activeSectionId);

  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    () => new Set(book.sections.map((s) => s.id)),
  );

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const activeIds = resolveActiveIds(activeSectionId, book.sections);

  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-border bg-card">
        <button
          onClick={closeBook}
          className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>All Books</span>
        </button>
        <div className="px-3 pb-2">
          <span className="text-sm font-medium text-foreground">{book.label}</span>
        </div>
      </div>

      <div className="flex-1 overflow-auto custom-scrollbar">
        {book.sections.map((section) => (
          <SectionNavItem
            key={section.id}
            section={section}
            expandedSections={expandedSections}
            toggleSection={toggleSection}
            activeIds={activeIds}
          />
        ))}
      </div>
    </div>
  );
}

/* -- Chapter-based Reader Mode ------------------------------------------- */

function ChapterReaderMode({ book }: { book: { key: string; label: string; chapters: LearnChapterMeta[] } }) {
  const activeChapter = useLearnStore((s) => s.activeChapter);
  const closeBook = useLearnStore((s) => s.closeBook);
  const closeChapter = useLearnStore((s) => s.closeChapter);
  const openChapter = useLearnStore((s) => s.openChapter);
  const activeSectionId = useLearnStore((s) => s.activeSectionId);

  // Group chapters by part
  const parts = groupByPart(book.chapters);

  // When a chapter is active, use its sections from the catalog metadata
  const chapterMeta = activeChapter ? book.chapters.find((c) => c.key === activeChapter) : null;
  const chapterSections = chapterMeta?.sections ?? [];
  const activeIds = resolveActiveIds(activeSectionId, chapterSections);

  const [expandedParts, setExpandedParts] = useState<Set<string>>(
    () => new Set(parts.map(([name]) => name)),
  );

  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    () => new Set(chapterSections.map((s) => s.id)),
  );

  const togglePart = (name: string) => {
    setExpandedParts((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-border bg-card">
        <button
          onClick={activeChapter ? closeChapter : closeBook}
          className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>{activeChapter ? book.label : "All Books"}</span>
        </button>
        <div className="px-3 pb-2">
          <span className="text-sm font-medium text-foreground">
            {chapterMeta?.title ?? book.label}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-auto custom-scrollbar">
        {activeChapter ? (
          /* Section navigation within the active chapter */
          chapterSections.map((section) => (
            <SectionNavItem
              key={section.id}
              section={section}
              expandedSections={expandedSections}
              toggleSection={toggleSection}
              activeIds={activeIds}
            />
          ))
        ) : (
          /* Chapter list grouped by part */
          parts.map(([partName, partChapters]) => (
            <CollapsibleGroup
              key={partName}
              label={partName}
              expanded={expandedParts.has(partName)}
              onToggle={() => togglePart(partName)}
            >
              {partChapters.map((ch) => (
                <button
                  key={ch.key}
                  onClick={() => openChapter(ch.key)}
                  className={cn(
                    "w-full flex items-center gap-2 pl-6 pr-3 py-2 text-xs transition-colors",
                    "hover:bg-accent/50 text-foreground",
                  )}
                >
                  <span className="text-muted-foreground/50 font-mono w-4 text-right shrink-0 text-[10px]">
                    {ch.number}
                  </span>
                  <span className="truncate font-medium">{ch.title}</span>
                </button>
              ))}
            </CollapsibleGroup>
          ))
        )}
      </div>
    </div>
  );
}

/* -- Shared Components --------------------------------------------------- */

function CollapsibleGroup({
  label,
  expanded,
  onToggle,
  children,
}: {
  label: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3 shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 shrink-0" />
        )}
        <span className="font-semibold">{label}</span>
      </button>
      {expanded && children}
    </div>
  );
}

function SectionNavItem({
  section,
  expandedSections,
  toggleSection,
  activeIds,
}: {
  section: LearnSection;
  expandedSections: Set<string>;
  toggleSection: (id: string) => void;
  activeIds: Set<string>;
}) {
  const isExpanded = expandedSections.has(section.id);
  const hasChildren = section.children.length > 0;
  const isActive = activeIds.has(section.id);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div>
      <button
        onClick={() => {
          if (hasChildren) toggleSection(section.id);
          scrollToSection(section.id);
        }}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors",
          "hover:bg-accent/50",
          isActive && "bg-accent/40 text-primary font-semibold",
        )}
      >
        {hasChildren ? (
          isExpanded ? (
            <ChevronDown className="w-3 h-3 shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 shrink-0" />
          )
        ) : (
          <span className="w-3 h-3 shrink-0" />
        )}
        <span className="truncate font-medium">{section.title}</span>
      </button>

      {hasChildren && isExpanded && (
        <div>
          {section.children.map((child) => (
            <button
              key={child.id}
              onClick={() => scrollToSection(child.id)}
              className={cn(
                "w-full flex items-center gap-2 pl-8 pr-3 py-1.5 text-xs transition-colors",
                "hover:bg-accent/50 text-foreground",
                activeIds.has(child.id) && "bg-accent/40 text-primary font-semibold",
              )}
            >
              <span className="truncate">{child.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* -- Helpers ------------------------------------------------------------- */

function groupByPart(chapters: LearnChapterMeta[]): [string, LearnChapterMeta[]][] {
  const map = new Map<string, LearnChapterMeta[]>();
  for (const ch of chapters) {
    const list = map.get(ch.part) || [];
    list.push(ch);
    map.set(ch.part, list);
  }
  return Array.from(map.entries());
}

function resolveActiveIds(activeSectionId: string | null, sections: LearnSection[]): Set<string> {
  const ids = new Set<string>();
  if (!activeSectionId) return ids;
  ids.add(activeSectionId);
  for (const section of sections) {
    if (section.id === activeSectionId) {
      ids.add(section.id);
      return ids;
    }
    for (const child of section.children) {
      if (child.id === activeSectionId) {
        ids.add(section.id);
        ids.add(child.id);
        return ids;
      }
    }
  }
  return ids;
}
