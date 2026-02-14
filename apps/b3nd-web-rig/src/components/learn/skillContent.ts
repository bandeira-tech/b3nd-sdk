import skillRaw from "../../../../../skills/b3nd/SKILL.md?raw";
import firecatRaw from "../../../../../skills/b3nd/FIRECAT.md?raw";
import faqRaw from "../../../../../skills/b3nd/FAQ.md?raw";

export type LearnDocument = "b3nd" | "firecat" | "faq";

export const learnDocuments: { key: LearnDocument; label: string; markdown: string }[] = [
  { key: "b3nd", label: "B3nd", markdown: skillRaw },
  { key: "firecat", label: "Firecat", markdown: firecatRaw },
  { key: "faq", label: "FAQ", markdown: faqRaw },
];

export function getDocumentMarkdown(key: LearnDocument): string {
  return learnDocuments.find((d) => d.key === key)?.markdown ?? skillRaw;
}

/** @deprecated Use getDocumentMarkdown instead */
export const skillMarkdown: string = skillRaw;
