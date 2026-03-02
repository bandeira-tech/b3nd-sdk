import { useEffect, useRef, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { BookOpen, ChefHat, Compass, Lightbulb, Loader2, Library, ChevronRight } from "lucide-react";
import {
  TIER_ORDER, booksByTier, findBook, isChapterBook,
  type LearnBook, type LearnCatalog, type LearnChapterMeta,
} from "./skillContent";
import { useLearnStore } from "./useLearnStore";
import { useRead } from "./useRead";

const CATALOG_URI = "mutable://open/rig/learn/catalog";

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function stripFrontmatter(md: string): string {
  return md.replace(/^---[\s\S]*?---\n*/, "");
}

const TIER_ICONS: Record<string, typeof BookOpen> = {
  guide: Library,
  documentation: BookOpen,
  cookbook: ChefHat,
  design: Compass,
  proposals: Lightbulb,
};

/* -- Root --------------------------------------------------------------- */

export function LearnLayoutSlot() {
  const activeBook = useLearnStore((s) => s.activeBook);
  const { data: catalog, loading, error } = useRead<LearnCatalog>(CATALOG_URI);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading learn catalog...</span>
      </div>
    );
  }

  if (error || !catalog) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-destructive">{error ?? "No catalog found."}</p>
      </div>
    );
  }

  if (!activeBook) return <IndexView catalog={catalog} />;

  const book = findBook(catalog.books, activeBook);
  if (!book) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-muted-foreground">Book not found.</p>
      </div>
    );
  }

  if (isChapterBook(book)) return <ChapterBookView book={book} />;
  return <SingleFileReaderView book={book} />;
}

/* -- Index View ---------------------------------------------------------- */

function IndexView({ catalog }: { catalog: LearnCatalog }) {
  const openBook = useLearnStore((s) => s.openBook);

  return (
    <div className="max-w-4xl mx-auto px-8 py-10 h-full overflow-y-auto custom-scrollbar">
      <h1 className="text-2xl font-bold text-foreground">Learn B3nd</h1>
      <p className="text-sm text-muted-foreground mt-1 mb-8">
        Reference documentation and hands-on recipes for building with B3nd.
      </p>

      {TIER_ORDER.map((tier) => {
        const tierBooks = booksByTier(catalog.books, tier.id);
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
      {isChapterBook(book) && (
        <p className="text-[10px] text-muted-foreground/60 mt-2">
          {book.chapters.length} chapters
        </p>
      )}
    </button>
  );
}

/* -- Chapter Book View --------------------------------------------------- */

function ChapterBookView({ book }: { book: LearnBook & { chapters: LearnChapterMeta[] } }) {
  const activeChapter = useLearnStore((s) => s.activeChapter);

  if (!activeChapter) return <ChapterIndexView book={book} />;

  const chapterMeta = book.chapters.find((c) => c.key === activeChapter);
  if (!chapterMeta) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-muted-foreground">Chapter not found.</p>
      </div>
    );
  }

  return <ChapterReaderView uri={chapterMeta.uri} />;
}

function ChapterIndexView({ book }: { book: LearnBook & { chapters: LearnChapterMeta[] } }) {
  const openChapter = useLearnStore((s) => s.openChapter);

  // Group chapters by part
  const parts = groupByPart(book.chapters);

  return (
    <div className="max-w-3xl mx-auto px-8 py-10 h-full overflow-y-auto custom-scrollbar">
      <h1 className="text-2xl font-bold text-foreground">{book.title}</h1>
      <p className="text-sm text-muted-foreground mt-1 mb-8">{book.description}</p>

      {parts.map(([partName, chapters]) => (
        <section key={partName} className="mb-8">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            {partName}
          </h2>
          <div className="space-y-1">
            {chapters.map((ch) => (
              <button
                key={ch.key}
                onClick={() => openChapter(ch.key)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-border hover:border-primary/40 hover:bg-accent/30 transition-colors group text-left"
              >
                <span className="text-xs text-muted-foreground/60 font-mono w-6 text-right shrink-0">
                  {ch.number}
                </span>
                <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors flex-1">
                  {ch.title}
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-primary/60 shrink-0" />
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/* -- Chapter Reader ------------------------------------------------------ */
/* Reads chapter content from its URI on demand. */

interface ChapterContent {
  key: string;
  title: string;
  markdown: string;
}

function ChapterReaderView({ uri }: { uri: string }) {
  const { data: chapter, loading } = useRead<ChapterContent>(uri);
  const setActiveSectionId = useLearnStore((s) => s.setActiveSectionId);
  const containerRef = useRef<HTMLElement>(null);

  const content = chapter ? stripFrontmatter(chapter.markdown) : "";

  // Scroll-spy
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !content) return;

    const onScroll = () => {
      const headings = container.querySelectorAll<HTMLElement>("h2[id], h3[id]");
      const offset = container.getBoundingClientRect().top;
      let active: string | null = null;
      for (const h of headings) {
        if (h.getBoundingClientRect().top - offset <= 40) active = h.id;
        else break;
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

  useEffect(() => {
    containerRef.current?.scrollTo(0, 0);
  }, [uri]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading chapter...</span>
      </div>
    );
  }

  if (!chapter) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-muted-foreground">Chapter not found.</p>
      </div>
    );
  }

  return (
    <article
      ref={containerRef}
      className="max-w-4xl mx-auto px-8 py-6 prose prose-sm dark:prose-invert overflow-y-auto h-full custom-scrollbar skill-prose"
    >
      <MarkdownContent content={content} />
    </article>
  );
}

/* -- Single-file Reader -------------------------------------------------- */

function SingleFileReaderView({ book }: { book: LearnBook }) {
  const setActiveSectionId = useLearnStore((s) => s.setActiveSectionId);
  const containerRef = useRef<HTMLElement>(null);
  const content = stripFrontmatter(book.markdown ?? "");

  // Scroll-spy
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onScroll = () => {
      const headings = container.querySelectorAll<HTMLElement>("h2[id], h3[id]");
      const offset = container.getBoundingClientRect().top;
      let active: string | null = null;
      for (const h of headings) {
        if (h.getBoundingClientRect().top - offset <= 40) active = h.id;
        else break;
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

  useEffect(() => {
    containerRef.current?.scrollTo(0, 0);
  }, [book.key]);

  return (
    <article
      ref={containerRef}
      className="max-w-4xl mx-auto px-8 py-6 prose prose-sm dark:prose-invert overflow-y-auto h-full custom-scrollbar skill-prose"
    >
      <MarkdownContent content={content} />
    </article>
  );
}

/* -- Shared Markdown Renderer -------------------------------------------- */

function MarkdownContent({ content }: { content: string }) {
  return (
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
          return <code className="skill-inline-code" {...rest}>{children}</code>;
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

/* -- Helpers ------------------------------------------------------------- */

function groupByPart(chapters: LearnChapterMeta[]): [string, LearnChapterMeta[]][] {
  const map = new Map<string, LearnChapterMeta[]>();
  for (const ch of chapters) {
    const list = map.get(ch.part) || [];
    list.push(ch);
    map.set(ch.part, list);
  }
  return Array.from(map.entries());
}

function extractText(children: unknown): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(extractText).join("");
  if (children && typeof children === "object" && "props" in children) {
    return extractText((children as { props: { children: unknown } }).props.children);
  }
  return "";
}
