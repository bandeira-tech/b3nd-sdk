import { useState, useMemo, useEffect } from "react";
import { ArrowLeft, BookOpen, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../../utils";
import { documentationDocs, cookbookDocs, designDocs, getDocumentMarkdown, getDocEntry } from "./skillContent";
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

/* ── Index Mode ─────────────────────────────────────────────── */

function IndexMode() {
  const openBook = useLearnStore((s) => s.openBook);
  const [expandedTiers, setExpandedTiers] = useState<Set<string>>(
    () => new Set(["Documentation", "Cookbooks", "Design"]),
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
        {/* Documentation tier */}
        <TierGroup
          label="Documentation"
          expanded={expandedTiers.has("Documentation")}
          onToggle={() => toggleTier("Documentation")}
        >
          {documentationDocs.map((doc) => (
            <button
              key={doc.key}
              onClick={() => openBook(doc.key)}
              className="w-full flex flex-col gap-0.5 pl-8 pr-3 py-2 text-left hover:bg-accent/50 transition-colors"
            >
              <span className="text-xs font-medium text-foreground truncate">{doc.label}</span>
              <span className="text-[10px] text-muted-foreground truncate">{doc.description}</span>
            </button>
          ))}
        </TierGroup>

        {/* Cookbooks tier */}
        <TierGroup
          label="Cookbooks"
          expanded={expandedTiers.has("Cookbooks")}
          onToggle={() => toggleTier("Cookbooks")}
        >
          {cookbookDocs.map((doc) => (
            <button
              key={doc.key}
              onClick={() => openBook(doc.key)}
              className="w-full flex flex-col gap-0.5 pl-8 pr-3 py-2 text-left hover:bg-accent/50 transition-colors"
            >
              <span className="text-xs font-medium text-foreground truncate">{doc.label}</span>
              <span className="text-[10px] text-muted-foreground truncate">{doc.description}</span>
            </button>
          ))}
        </TierGroup>

        {/* Design tier */}
        <TierGroup
          label="Design"
          expanded={expandedTiers.has("Design")}
          onToggle={() => toggleTier("Design")}
        >
          {designDocs.map((doc) => (
            <button
              key={doc.key}
              onClick={() => openBook(doc.key)}
              className="w-full flex flex-col gap-0.5 pl-8 pr-3 py-2 text-left hover:bg-accent/50 transition-colors"
            >
              <span className="text-xs font-medium text-foreground truncate">{doc.label}</span>
              <span className="text-[10px] text-muted-foreground truncate">{doc.description}</span>
            </button>
          ))}
        </TierGroup>
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

/* ── Reader Mode ────────────────────────────────────────────── */

function ReaderMode() {
  const activeBook = useLearnStore((s) => s.activeBook)!;
  const closeBook = useLearnStore((s) => s.closeBook);
  const activeSectionId = useLearnStore((s) => s.activeSectionId);

  const entry = getDocEntry(activeBook);
  const markdown = useMemo(() => getDocumentMarkdown(activeBook), [activeBook]);
  const sections = useMemo(() => parseSkillSections(markdown), [markdown]);

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
          <span className="text-sm font-medium text-foreground">{entry?.label}</span>
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

/* ── Section Nav Item ───────────────────────────────────────── */

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
