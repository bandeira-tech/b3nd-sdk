import { useState, useMemo } from "react";
import { BookOpen, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../../utils";
import { skillMarkdown } from "./skillContent";
import { parseSkillSections, type SkillSection } from "./parseSkillSections";

export function LearnLeftSlot() {
  const sections = useMemo(() => parseSkillSections(skillMarkdown), []);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    () => new Set(sections.map((s) => s.id)),
  );

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

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-border bg-card flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium">Documentation</span>
      </div>

      {/* Navigation tree */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        {sections.map((section) => (
          <SectionNavItem
            key={section.id}
            section={section}
            expandedSections={expandedSections}
            toggleSection={toggleSection}
            scrollToSection={scrollToSection}
          />
        ))}
      </div>
    </div>
  );
}

function SectionNavItem({
  section,
  expandedSections,
  toggleSection,
  scrollToSection,
}: {
  section: SkillSection;
  expandedSections: Set<string>;
  toggleSection: (id: string) => void;
  scrollToSection: (id: string) => void;
}) {
  const isExpanded = expandedSections.has(section.id);
  const hasChildren = section.children.length > 0;

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
