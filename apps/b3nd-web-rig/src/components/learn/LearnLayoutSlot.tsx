import { useMemo, useEffect, useRef, useCallback, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { skillMarkdown } from "./skillContent";
import { useLearnStore } from "./useLearnStore";

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
  const containerRef = useRef<HTMLElement>(null);
  const setActiveSectionId = useLearnStore((s) => s.setActiveSectionId);

  // Scroll-spy: observe all heading elements
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Small delay to let markdown render
    const timer = setTimeout(() => {
      const headings = container.querySelectorAll<HTMLElement>("h2[id], h3[id]");
      if (headings.length === 0) return;

      const observer = new IntersectionObserver(
        (entries) => {
          // Find the topmost visible heading
          const visible = entries
            .filter((e) => e.isIntersecting)
            .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

          if (visible.length > 0) {
            setActiveSectionId(visible[0].target.id);
          }
        },
        { root: container, rootMargin: "0px 0px -80% 0px", threshold: 0 },
      );

      headings.forEach((h) => observer.observe(h));
      return () => observer.disconnect();
    }, 100);

    return () => clearTimeout(timer);
  }, [content, setActiveSectionId]);

  const codeComponent = useCallback(
    ({ className, children, ...rest }: ComponentPropsWithoutRef<"code"> & { className?: string }) => {
      const match = className?.match(/language-(\w+)/);
      if (match) {
        return (
          <SyntaxHighlighter
            style={oneDark}
            language={match[1]}
            PreTag="div"
            customStyle={{ margin: 0, borderRadius: "0.375rem", fontSize: "0.8125rem" }}
          >
            {String(children).replace(/\n$/, "")}
          </SyntaxHighlighter>
        );
      }
      return (
        <code className="skill-inline-code" {...rest}>
          {children}
        </code>
      );
    },
    [],
  );

  return (
    <article
      ref={containerRef}
      className="max-w-4xl mx-auto px-8 py-6 prose prose-sm dark:prose-invert overflow-y-auto h-full custom-scrollbar skill-prose"
    >
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
          code: codeComponent,
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
