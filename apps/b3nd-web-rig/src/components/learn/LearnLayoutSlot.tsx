import { useMemo, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { skillMarkdown } from "./skillContent";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function stripFrontmatter(md: string): string {
  return md.replace(/^---[\s\S]*?---\n*/, "");
}

export function LearnLayoutSlot() {
  const content = useMemo(() => stripFrontmatter(skillMarkdown), []);

  return (
    <article className="max-w-4xl mx-auto px-8 py-6 prose prose-sm dark:prose-invert overflow-y-auto h-full custom-scrollbar skill-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (props: ComponentPropsWithoutRef<"h1">) => {
            const text = extractText(props.children);
            return <h1 id={slugify(text)} {...props} />;
          },
          h2: (props: ComponentPropsWithoutRef<"h2">) => {
            const text = extractText(props.children);
            return <h2 id={slugify(text)} {...props} />;
          },
          h3: (props: ComponentPropsWithoutRef<"h3">) => {
            const text = extractText(props.children);
            return <h3 id={slugify(text)} {...props} />;
          },
          code: ({ className, children, ...rest }: ComponentPropsWithoutRef<"code"> & { className?: string }) => {
            const isBlock = className?.startsWith("language-");
            if (isBlock) {
              return (
                <code className={className} {...rest}>
                  {children}
                </code>
              );
            }
            return (
              <code className="skill-inline-code" {...rest}>
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}

function extractText(children: unknown): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(extractText).join("");
  if (children && typeof children === "object" && "props" in children) {
    return extractText((children as { props: { children: unknown } }).props.children);
  }
  return "";
}
