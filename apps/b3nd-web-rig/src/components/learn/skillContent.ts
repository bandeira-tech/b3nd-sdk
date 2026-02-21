import skillRaw from "../../../../../skills/b3nd/SKILL.md?raw";
import firecatRaw from "../../../../../skills/b3nd/FIRECAT.md?raw";
import faqRaw from "../../../../../skills/b3nd/FAQ.md?raw";
import frameworkRaw from "../../../../../skills/b3nd/FRAMEWORK.md?raw";
import operatorsRaw from "../../../../../skills/b3nd/OPERATORS.md?raw";

export type LearnDocument = "b3nd" | "firecat" | "faq" | "framework" | "operators";

export const learnDocuments: { key: LearnDocument; label: string; markdown: string }[] = [
  { key: "b3nd", label: "B3nd", markdown: skillRaw },
  { key: "firecat", label: "Firecat", markdown: firecatRaw },
  { key: "faq", label: "FAQ", markdown: faqRaw },
  { key: "framework", label: "Framework", markdown: frameworkRaw },
  { key: "operators", label: "Operators", markdown: operatorsRaw },
];

export const learnGroups: { label: string; docs: LearnDocument[] }[] = [
  { label: "Overview", docs: ["b3nd", "faq"] },
  { label: "App Developers", docs: ["firecat"] },
  { label: "Protocol Designers", docs: ["framework"] },
  { label: "Infrastructure Operators", docs: ["operators"] },
];

export function getDocumentMarkdown(key: LearnDocument): string {
  return learnDocuments.find((d) => d.key === key)?.markdown ?? skillRaw;
}

/** @deprecated Use getDocumentMarkdown instead */
export const skillMarkdown: string = skillRaw;
