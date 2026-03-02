import { useState, useMemo, useEffect } from "react";
import { ArrowLeft, BookOpen, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../../utils";
import { TIER_ORDER, booksByTier, findBook, isChapterBook, type LearnChapterMeta } from "./skillContent";
import { parseSkillSections, type SkillSection } from "./parseSkillSections";
import { useLearnStore } from "./useLearnStore";

export function LearnLeftSlot() {
  const activeBook = useLearnStore((s) => s.activeBook);

  return (
    <div className="h-full flex flex-col">
      {activeBook === null ? <IndexMode /> : <ReaderMode />}
    </div>
  );
}

/* -- Index Mode ---------------------------------------------------------- */

function IndexMode() {
  const openBook = useLearnStore((s) => s.openBook);
  const catalog = useLearnStore((s) => s.catalog);
  const books = catalog?.books ?? [];

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
    <>
      <div className="p-3 border-b border-border bg-card flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium">Learn</span>
      </div>

      <div className="flex-1 overflow-auto custom-scrollbar py-1">
        {TIER_ORDER.map((tier) => {
          const tierBooks = booksByTier(books, tier.id);
          if (tierBooks.length === 0) return null;

          return (
            <TierGroup
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
            </TierGroup>
          );
        })}
      </div>
    </>
  );
}

function TierGroup({
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

/* -- Reader Mode --------------------------------------------------------- */

function ReaderMode() {
  const activeBook = useLearnStore((s) => s.activeBook)!;
  const catalog = useLearnStore((s) => s.catalog);
  const book = useMemo(() => findBook(catalog?.books ?? [], activeBook), [catalog, activeBook]);

  if (book && isChapterBook(book)) return <ChapterReaderMode />;
  return <SingleFileReaderMode />;
}

/* -- Single-file Reader Mode --------------------------------------------- */

function SingleFileReaderMode() {
  const activeBook = useLearnStore((s) => s.activeBook)!;
  const closeBook = useLearnStore((s) => s.closeBook);
  const activeSectionId = useLearnStore((s) => s.activeSectionId);
  const catalog = useLearnStore((s) => s.catalog);

  const book = useMemo(() => findBook(catalog?.books ?? [], activeBook), [catalog, activeBook]);
  const sections = useMemo(() => parseSkillSections(book?.markdown ?? ""), [book]);

  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    () => new Set(sections.map((s) => s.id)),
  );

  useEffect(() => {
    setExpandedSections(new Set(sections.map((s) => s.id)));
  }, [sections]);

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const activeIds = useMemo(() => {
    const ids = new Set<string>();
    if (!activeSectionId) return ids;
    ids.add(activeSectionId);
    for (const section of sections) {
      if (section.id === activeSectionId) {
        ids.add(section.id);
        break;
      }
      for (const child of section.children) {
        if (child.id === activeSectionId) {
          ids.add(section.id);
          ids.add(child.id);
          break;
        }
      }
    }
    return ids;
  }, [activeSectionId, sections]);

  return (
    <>
      {/* Back button + book title */}
      <div className="border-b border-border bg-card">
        <button
          onClick={closeBook}
          className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>All Books</span>
        </button>
        <div className="px-3 pb-2">
          <span className="text-sm font-medium text-foreground">{book?.label ?? activeBook}</span>
        </div>
      </div>

      {/* Section navigation tree */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        {sections.map((section) => (
          <SectionNavItem
            key={section.id}
            section={section}
            expandedSections={expandedSections}
            toggleSection={toggleSection}
            scrollToSection={scrollToSection}
            activeIds={activeIds}
          />
        ))}
      </div>
    </>
  );
}

/* -- Chapter-based Reader Mode ------------------------------------------- */

function ChapterReaderMode() {
  const activeBook = useLearnStore((s) => s.activeBook)!;
  const activeChapter = useLearnStore((s) => s.activeChapter);
  const closeBook = useLearnStore((s) => s.closeBook);
  const closeChapter = useLearnStore((s) => s.closeChapter);
  const openChapter = useLearnStore((s) => s.openChapter);
  const activeSectionId = useLearnStore((s) => s.activeSectionId);
  const chapterCache = useLearnStore((s) => s.chapterCache);
  const catalog = useLearnStore((s) => s.catalog);

  const book = useMemo(() => findBook(catalog?.books ?? [], activeBook), [catalog, activeBook]);
  const chapters = (book && isChapterBook(book)) ? book.chapters : [];

  // Group chapters by part for navigation
  const parts = useMemo(() => {
    const map = new Map<string, LearnChapterMeta[]>();
    for (const ch of chapters) {
      const list = map.get(ch.part) || [];
      list.push(ch);
      map.set(ch.part, list);
    }
    return Array.from(map.entries());
  }, [chapters]);

  // When a chapter is active, show its sections; otherwise show the chapter list
  const chapterSections = useMemo(() => {
    if (!activeChapter) return [];
    const cacheKey = `${activeBook}/${activeChapter}`;
    const cached = chapterCache[cacheKey];
    if (!cached) return [];
    return parseSkillSections(cached.markdown);
  }, [activeBook, activeChapter, chapterCache]);

  const [expandedParts, setExpandedParts] = useState<Set<string>>(
    () => new Set(parts.map(([name]) => name)),
  );

  useEffect(() => {
    setExpandedParts(new Set(parts.map(([name]) => name)));
  }, [parts]);

  const togglePart = (name: string) => {
    setExpandedParts((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Active section tracking for within-chapter scroll-spy
  const activeIds = useMemo(() => {
    const ids = new Set<string>();
    if (!activeSectionId) return ids;
    ids.add(activeSectionId);
    for (const section of chapterSections) {
      if (section.id === activeSectionId) {
        ids.add(section.id);
        break;
      }
      for (const child of section.children) {
        if (child.id === activeSectionId) {
          ids.add(section.id);
          ids.add(child.id);
          break;
        }
      }
    }
    return ids;
  }, [activeSectionId, chapterSections]);

  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  useEffect(() => {
    setExpandedSections(new Set(chapterSections.map((s) => s.id)));
  }, [chapterSections]);

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      {/* Header with back navigation */}
      <div className="border-b border-border bg-card">
        <button
          onClick={activeChapter ? closeChapter : closeBook}
          className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>{activeChapter ? book?.label ?? "Chapters" : "All Books"}</span>
        </button>
        <div className="px-3 pb-2">
          <span className="text-sm font-medium text-foreground">
            {activeChapter
              ? chapters.find((c) => c.key === activeChapter)?.title ?? activeChapter
              : book?.label ?? activeBook}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-auto custom-scrollbar">
        {activeChapter ? (
          /* Within-chapter section navigation */
          <>
            {chapterSections.map((section) => (
              <SectionNavItem
                key={section.id}
                section={section}
                expandedSections={expandedSections}
                toggleSection={toggleSection}
                scrollToSection={scrollToSection}
                activeIds={activeIds}
              />
            ))}
          </>
        ) : (
          /* Chapter list grouped by part */
          <>
            {parts.map(([partName, partChapters]) => (
              <div key={partName}>
                <button
                  onClick={() => togglePart(partName)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                >
                  {expandedParts.has(partName) ? (
                    <ChevronDown className="w-3 h-3 shrink-0" />
                  ) : (
                    <ChevronRight className="w-3 h-3 shrink-0" />
                  )}
                  <span className="font-semibold">{partName}</span>
                </button>
                {expandedParts.has(partName) &&
                  partChapters.map((ch) => (
                    <button
                      key={ch.key}
                      onClick={() => openChapter(activeBook, ch.key)}
                      className={cn(
                        "w-full flex items-center gap-2 pl-6 pr-3 py-2 text-xs transition-colors",
                        "hover:bg-accent/50 text-foreground",
                        activeChapter === ch.key && "bg-accent/40 text-primary font-semibold",
                      )}
                    >
                      <span className="text-muted-foreground/50 font-mono w-4 text-right shrink-0 text-[10px]">
                        {ch.number}
                      </span>
                      <span className="truncate font-medium">{ch.title}</span>
                    </button>
                  ))}
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}

/* -- Section Nav Item ---------------------------------------------------- */

function SectionNavItem({
  section,
  expandedSections,
  toggleSection,
  scrollToSection,
  activeIds,
}: {
  section: SkillSection;
  expandedSections: Set<string>;
  toggleSection: (id: string) => void;
  scrollToSection: (id: string) => void;
  activeIds: Set<string>;
}) {
  const isExpanded = expandedSections.has(section.id);
  const hasChildren = section.children.length > 0;
  const isActive = activeIds.has(section.id);

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
          {section.children.map((child) => {
            const childActive = activeIds.has(child.id);
            return (
              <button
                key={child.id}
                onClick={() => scrollToSection(child.id)}
                className={cn(
                  "w-full flex items-center gap-2 pl-8 pr-3 py-1.5 text-xs transition-colors",
                  "hover:bg-accent/50 text-foreground",
                  childActive && "bg-accent/40 text-primary font-semibold",
                )}
              >
                <span className="truncate">{child.title}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
