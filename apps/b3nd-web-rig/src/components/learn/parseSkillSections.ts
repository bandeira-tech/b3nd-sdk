export interface SkillSection {
  id: string;
  title: string;
  level: number;
  content: string;
  children: SkillSection[];
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function parseSkillSections(markdown: string): SkillSection[] {
  // Strip YAML frontmatter
  const stripped = markdown.replace(/^---[\s\S]*?---\n*/, "");
  const lines = stripped.split("\n");
  const sections: SkillSection[] = [];
  let currentH2: SkillSection | null = null;
  let currentH3: SkillSection | null = null;
  let buffer: string[] = [];

  const flushBuffer = () => {
    const content = buffer.join("\n").trim();
    buffer = [];
    return content;
  };

  for (const line of lines) {
    const h2Match = line.match(/^## (.+)$/);
    const h3Match = line.match(/^### (.+)$/);

    if (h2Match) {
      // Flush previous content
      const content = flushBuffer();
      if (currentH3 && currentH2) {
        currentH3.content = content;
      } else if (currentH2) {
        currentH2.content = content;
      }
      currentH3 = null;

      const title = h2Match[1];
      currentH2 = {
        id: slugify(title),
        title,
        level: 2,
        content: "",
        children: [],
      };
      sections.push(currentH2);
    } else if (h3Match) {
      const content = flushBuffer();
      if (currentH3 && currentH2) {
        currentH3.content = content;
      } else if (currentH2) {
        currentH2.content = content;
      }

      const title = h3Match[1];
      currentH3 = {
        id: slugify(title),
        title,
        level: 3,
        content: "",
        children: [],
      };
      if (currentH2) {
        currentH2.children.push(currentH3);
      }
    } else {
      buffer.push(line);
    }
  }

  // Flush last section
  const content = flushBuffer();
  if (currentH3 && currentH2) {
    currentH3.content = content;
  } else if (currentH2) {
    currentH2.content = content;
  }

  return sections;
}
