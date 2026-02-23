import { useMemo, useEffect, useRef, useCallback, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { BookOpen, ChefHat, Compass } from "lucide-react";
import { getDocumentMarkdown, documentationDocs, cookbookDocs, designDocs, type LearnDocEntry } from "./skillContent";
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
  const activeBook = useLearnStore((s) => s.activeBook);

  if (activeBook === null) return <IndexView />;
  return <ReaderView />;
}

/* ── Index View ─────────────────────────────────────────────── */

function IndexView() {
  const openBook = useLearnStore((s) => s.openBook);

  return (
    <div className="max-w-4xl mx-auto px-8 py-10 h-full overflow-y-auto custom-scrollbar">
      <h1 className="text-2xl font-bold text-foreground">Learn B3nd</h1>
      <p className="text-sm text-muted-foreground mt-1 mb-8">
        Reference documentation and hands-on recipes for building with B3nd.
      </p>

      {/* Documentation */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <BookOpen className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Documentation</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {documentationDocs.map((doc) => (
            <BookCard key={doc.key} doc={doc} onClick={() => openBook(doc.key)} />
          ))}
        </div>
      </section>

      {/* Cookbooks */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <ChefHat className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cookbooks</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {cookbookDocs.map((doc) => (
            <BookCard key={doc.key} doc={doc} onClick={() => openBook(doc.key)} />
          ))}
        </div>
      </section>

      {/* Design */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Compass className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Design</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {designDocs.map((doc) => (
            <BookCard key={doc.key} doc={doc} onClick={() => openBook(doc.key)} />
          ))}
        </div>
      </section>
    </div>
  );
}

function BookCard({ doc, onClick }: { doc: LearnDocEntry; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-left border border-border rounded-lg p-4 hover:border-primary/40 hover:bg-accent/30 transition-colors group"
    >
      <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
        {doc.label}
      </span>
      <p className="text-xs text-muted-foreground mt-1">{doc.description}</p>
    </button>
  );
}

/* ── Reader View ────────────────────────────────────────────── */

function ReaderView() {
  const activeBook = useLearnStore((s) => s.activeBook)!;
  const markdown = useMemo(() => getDocumentMarkdown(activeBook), [activeBook]);
  const content = useMemo(() => stripFrontmatter(markdown), [markdown]);
  const containerRef = useRef<HTMLElement>(null);
  const setActiveSectionId = useLearnStore((s) => s.setActiveSectionId);

  // Scroll-spy
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

    const timer = setTimeout(onScroll, 100);
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      container.removeEventListener("scroll", onScroll);
    };
  }, [content, setActiveSectionId]);

  // Scroll to top when book changes
  useEffect(() => {
    containerRef.current?.scrollTo(0, 0);
  }, [activeBook]);

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
