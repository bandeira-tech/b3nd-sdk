import { useMemo, useEffect, useRef, useCallback, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { BookOpen, ChefHat, Compass, Lightbulb, Loader2 } from "lucide-react";
import { TIER_ORDER, booksByTier, findBook, type LearnBook } from "./skillContent";
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

const TIER_ICONS: Record<string, typeof BookOpen> = {
  documentation: BookOpen,
  cookbook: ChefHat,
  design: Compass,
  proposals: Lightbulb,
};

export function LearnLayoutSlot() {
  const activeBook = useLearnStore((s) => s.activeBook);
  const loading = useLearnStore((s) => s.loading);
  const error = useLearnStore((s) => s.error);
  const catalog = useLearnStore((s) => s.catalog);
  const loadCatalog = useLearnStore((s) => s.loadCatalog);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  if (loading || (!catalog && !error)) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading learn catalog...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (activeBook === null) return <IndexView />;
  return <ReaderView />;
}

/* -- Index View ---------------------------------------------------------- */

function IndexView() {
  const openBook = useLearnStore((s) => s.openBook);
  const catalog = useLearnStore((s) => s.catalog);
  const books = catalog?.books ?? [];

  return (
    <div className="max-w-4xl mx-auto px-8 py-10 h-full overflow-y-auto custom-scrollbar">
      <h1 className="text-2xl font-bold text-foreground">Learn B3nd</h1>
      <p className="text-sm text-muted-foreground mt-1 mb-8">
        Reference documentation and hands-on recipes for building with B3nd.
      </p>

      {TIER_ORDER.map((tier) => {
        const tierBooks = booksByTier(books, tier.id);
        if (tierBooks.length === 0) return null;
        const Icon = TIER_ICONS[tier.id] ?? BookOpen;

        return (
          <section key={tier.id} className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <Icon className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {tier.label}
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {tierBooks.map((book) => (
                <BookCard key={book.key} book={book} onClick={() => openBook(book.key)} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function BookCard({ book, onClick }: { book: LearnBook; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-left border border-border rounded-lg p-4 hover:border-primary/40 hover:bg-accent/30 transition-colors group"
    >
      <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
        {book.label}
      </span>
      <p className="text-xs text-muted-foreground mt-1">{book.description}</p>
    </button>
  );
}

/* -- Reader View --------------------------------------------------------- */

function ReaderView() {
  const activeBook = useLearnStore((s) => s.activeBook)!;
  const catalog = useLearnStore((s) => s.catalog);
  const book = useMemo(() => findBook(catalog?.books ?? [], activeBook), [catalog, activeBook]);
  const content = useMemo(() => stripFrontmatter(book?.markdown ?? ""), [book]);
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

  if (!book) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-muted-foreground">Book not found.</p>
      </div>
    );
  }

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
