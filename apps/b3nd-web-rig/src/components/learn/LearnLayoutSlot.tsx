import { useMemo, useEffect, useRef, useCallback, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { getDocumentMarkdown } from "./skillContent";
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
  const activeDocument = useLearnStore((s) => s.activeDocument);
  const markdown = useMemo(() => getDocumentMarkdown(activeDocument), [activeDocument]);
  const content = useMemo(() => stripFrontmatter(markdown), [markdown]);
  const containerRef = useRef<HTMLElement>(null);
  const setActiveSectionId = useLearnStore((s) => s.setActiveSectionId);

  // Scroll-spy: on scroll, find the last heading above the top of the viewport
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onScroll = () => {
      const headings = container.querySelectorAll<HTMLElement>("h2[id], h3[id]");
      const offset = container.getBoundingClientRect().top;
      let active: string | null = null;

      for (const h of headings) {
        if (h.getBoundingClientRect().top - offset <= 40) {
          active = h.id;
        } else {
          break;
        }
      }
      setActiveSectionId(active);
    };

    // Run once after render, then on every scroll
    const timer = setTimeout(onScroll, 100);
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      container.removeEventListener("scroll", onScroll);
    };
  }, [content, setActiveSectionId]);

  // Scroll to top when document changes
  useEffect(() => {
    containerRef.current?.scrollTo(0, 0);
  }, [activeDocument]);

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
