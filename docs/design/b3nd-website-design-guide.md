# B3nd Website Design Guide

**Entity:** B3nd — The Data Protocol **Domain:** b3nd.dev (or similar)
**Audience:** Protocol designers, infrastructure builders, SDK consumers
**Personality:** Architectural, precise, timeless. A blueprint. A mathematical
proof.

---

## 1. Color System

B3nd's palette is derived from deep indigo — the color of deep space, of ink, of
blueprints. It communicates permanence, trust, and engineering rigor. Orange
enters only as a structural accent: a pinpoint of warmth in a precise system,
like the dot in `b3nd.` — a punctuation mark, not a mood.

### 1.1 Core Palette

| Role                  | Hex       | Usage                                                                  |
| --------------------- | --------- | ---------------------------------------------------------------------- |
| Primary (Deep Indigo) | `#1e1b4b` | Hero backgrounds, footer, primary headings, nav logo                   |
| Secondary (Indigo)    | `#4338ca` | Interactive elements, links, hover states, borders                     |
| Accent (Orange)       | `#f97316` | The dot. Sparse highlights. Protocol family labels. Never backgrounds. |
| Success (Emerald)     | `#10b981` | Positive states, "users own the data" messaging, connection lines      |

### 1.2 Background Colors

| Role                | Hex       | Usage                                                        |
| ------------------- | --------- | ------------------------------------------------------------ |
| White               | `#ffffff` | Primary content sections                                     |
| Light               | `#f8fafc` | Alternating sections (protocol, ownership, run-your-own)     |
| Code Background     | `#0f0e1a` | Terminal panels, code blocks — near-black with a purple cast |
| Hero Gradient Start | `#1e1b4b` | Hero section linear-gradient start                           |
| Hero Gradient Mid   | `#2d2a6e` | Hero section linear-gradient midpoint                        |
| Hero Gradient End   | `#1a1744` | Hero section linear-gradient end                             |

### 1.3 Text Colors

| Role           | Hex                     | Usage                                                |
| -------------- | ----------------------- | ---------------------------------------------------- |
| Heading Text   | `#1e1b4b`               | Section titles, card headings — same as primary      |
| Body Text      | `#1f2937`               | Paragraphs, descriptions                             |
| Muted Text     | `#6b7280`               | Subtitles, captions, secondary descriptions          |
| White Text     | `#ffffff`               | Text on dark backgrounds (hero, footer, code blocks) |
| White Text 70% | `rgba(255,255,255,0.7)` | Subtitle text on hero                                |
| White Text 50% | `rgba(255,255,255,0.5)` | Tagline text on hero                                 |
| White Text 40% | `rgba(255,255,255,0.4)` | Terminal labels in code blocks                       |
| Footer Text    | `rgba(255,255,255,0.6)` | Footer body text and links                           |

### 1.4 Syntax Highlighting (Code Blocks)

| Role      | Hex                      | Usage                                                          |
| --------- | ------------------------ | -------------------------------------------------------------- |
| Keywords  | `#c084fc`                | `await`, `const`, `import`                                     |
| Strings   | `#86efac`                | String literals, also used for inline code on dark backgrounds |
| Functions | `#93c5fd`                | Function names, method calls                                   |
| Comments  | `rgba(255,255,255,0.35)` | Code comments                                                  |

### 1.5 Semantic Colors

| Role    | Hex       | Usage                                                  |
| ------- | --------- | ------------------------------------------------------ |
| Success | `#10b981` | Positive states, connected nodes, ownership indicators |
| Warning | `#f59e0b` | Caution states, terminal dot (yellow)                  |
| Error   | `#ef4444` | Error states, terminal dot (red), destructive actions  |
| Info    | `#4338ca` | Informational states (same as secondary)               |

### 1.6 Border & Separator Colors

| Role             | Hex                     | Usage                                               |
| ---------------- | ----------------------- | --------------------------------------------------- |
| Light Border     | `#e5e7eb`               | Card borders, nav bottom border, separators         |
| Secondary Border | `#4338ca`               | Operation boxes, URI anatomy outline, active states |
| Footer Separator | `rgba(255,255,255,0.1)` | Footer horizontal rule                              |

### 1.7 CSS Custom Properties

```css
:root {
  /* --- B3nd Core Palette --- */
  --b3nd-primary: #1e1b4b;
  --b3nd-secondary: #4338ca;
  --b3nd-accent: #f97316;
  --b3nd-success: #10b981;

  /* --- Backgrounds --- */
  --b3nd-bg-white: #ffffff;
  --b3nd-bg-light: #f8fafc;
  --b3nd-bg-code: #0f0e1a;
  --b3nd-bg-hero-start: #1e1b4b;
  --b3nd-bg-hero-mid: #2d2a6e;
  --b3nd-bg-hero-end: #1a1744;

  /* --- Text --- */
  --b3nd-text-heading: #1e1b4b;
  --b3nd-text-body: #1f2937;
  --b3nd-text-muted: #6b7280;
  --b3nd-text-white: #ffffff;
  --b3nd-text-white-70: rgba(255, 255, 255, 0.7);
  --b3nd-text-white-50: rgba(255, 255, 255, 0.5);
  --b3nd-text-white-40: rgba(255, 255, 255, 0.4);
  --b3nd-text-footer: rgba(255, 255, 255, 0.6);

  /* --- Syntax Highlighting --- */
  --b3nd-syntax-keyword: #c084fc;
  --b3nd-syntax-string: #86efac;
  --b3nd-syntax-function: #93c5fd;
  --b3nd-syntax-comment: rgba(255, 255, 255, 0.35);

  /* --- Semantic --- */
  --b3nd-semantic-success: #10b981;
  --b3nd-semantic-warning: #f59e0b;
  --b3nd-semantic-error: #ef4444;
  --b3nd-semantic-info: #4338ca;

  /* --- Borders --- */
  --b3nd-border-light: #e5e7eb;
  --b3nd-border-active: #4338ca;
  --b3nd-border-footer: rgba(255, 255, 255, 0.1);

  /* --- Shadows --- */
  --b3nd-shadow-card-hover: 0 8px 24px rgba(67, 56, 202, 0.1);
  --b3nd-shadow-nav: 0 1px 0 #e5e7eb;

  /* --- Radius --- */
  --b3nd-radius-sm: 6px;
  --b3nd-radius-md: 8px;
  --b3nd-radius-lg: 10px;

  /* --- Transitions --- */
  --b3nd-transition-fast: 0.2s ease;
  --b3nd-transition-normal: 0.3s ease;
}
```

---

## 2. Typography

B3nd uses two fonts that embody its dual nature: Inter for human-readable
communication, JetBrains Mono for protocol-level precision. There is no third
font. There is no decorative typeface. The typography is as minimal as the
protocol itself.

### 2.1 Font Families

| Role            | Font           | Fallback Stack                                  |
| --------------- | -------------- | ----------------------------------------------- |
| Headings        | Inter          | `-apple-system, BlinkMacSystemFont, sans-serif` |
| Body            | Inter          | `-apple-system, BlinkMacSystemFont, sans-serif` |
| Code / Protocol | JetBrains Mono | `Menlo, Consolas, monospace`                    |

```css
:root {
  --b3nd-font-body: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
  --b3nd-font-code: "JetBrains Mono", Menlo, Consolas, monospace;
}
```

### 2.2 Font Scale

The type scale is restrained. The hero is the only moment of expressive scale.
Everything else serves readability and scanability.

| Level                | Size                       | Weight  | Line Height | Letter Spacing | Usage                                                 |
| -------------------- | -------------------------- | ------- | ----------- | -------------- | ----------------------------------------------------- |
| Hero                 | `clamp(64px, 12vw, 120px)` | 700     | 1.0         | `-0.02em`      | Hero `h1` only. One per page.                         |
| H1 / Section Title   | `clamp(28px, 4vw, 36px)`   | 700     | 1.2         | `-0.01em`      | Section headings                                      |
| H2 / Card Title      | `18px`                     | 600     | 1.3         | `0`            | Card headings, subsection titles                      |
| H3 / Component Label | `16px`                     | 600     | 1.4         | `0`            | Operation box titles, level card headings             |
| H4 / Small Heading   | `14px`                     | 600     | 1.4         | `0`            | Footer headings, minor labels                         |
| Body                 | `15-16px`                  | 400     | 1.6         | `0`            | Paragraph text                                        |
| Small                | `14px`                     | 400-500 | 1.5         | `0`            | Nav links, footer links, card descriptions            |
| Caption              | `13px`                     | 400     | 1.5         | `0`            | Card descriptions, protocol card text, code font-size |
| Tagline              | `clamp(16px, 2.5vw, 22px)` | 400     | 1.4         | `0.15em`       | Hero tagline, always lowercase                        |
| Mono Labels          | `12px`                     | 400     | 1.4         | `0`            | Terminal labels                                       |

### 2.3 Font Loading

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link
  href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
  rel="stylesheet"
>
```

### 2.4 Typography Rules

1. **JetBrains Mono is reserved** for: URI strings, protocol names
   (`mutable://`), code blocks, inline code, terminal labels, and the `.link`
   class on cards. It never appears in headings or body copy.
2. **The hero tagline** is always lowercase with wide letter-spacing (`0.15em`).
   This is the one place the site whispers rather than speaks.
3. **Section titles** are centered. Body text within sections is left-aligned.
4. **No italic text anywhere.** The protocol does not hedge.

---

## 3. Layout Philosophy

The B3nd site is vertically stacked, single-column-centric, with a narrow
maximum width. This is deliberate: a protocol is a linear specification. You
read it top to bottom. There are no sidebars, no sprawling multi-column layouts,
no competing information hierarchies.

### 3.1 Grid & Container

```css
.container {
  max-width: 1100px;
  margin: 0 auto;
  padding: 0 24px;
}
```

- **Max width: 1100px.** This is tighter than most marketing sites (which often
  go to 1200-1400px). The constraint is intentional: it keeps code blocks
  readable, keeps the eye from wandering, and creates a focused reading
  experience.
- **Horizontal padding: 24px.** Consistent on all breakpoints.
- **Code blocks are further constrained** to `max-width: 700px` and centered
  within the container.

### 3.2 Section Rhythm

| Element                     | Value             | Notes                                    |
| --------------------------- | ----------------- | ---------------------------------------- |
| Section padding             | `80px 0`          | Vertical breathing room between sections |
| Hero padding                | `100px 24px 60px` | Extra top padding to clear fixed nav     |
| Section title margin-bottom | `48px`            | Space between heading and content        |
| Card grid gap               | `16-20px`         | Tight but not cramped                    |
| Code flow gap               | `20px`            | Between stacked code panels              |
| Footer padding              | `48px 0 32px`     | Top-heavy to create separation           |

### 3.3 Section Alternation

Sections alternate between `--b3nd-bg-white` and `--b3nd-bg-light` to create
visual rhythm without borders or heavy separators:

```
Hero:         Deep indigo gradient (dark)
Protocol:     Light background (#f8fafc)
Code:         White background (#ffffff)
Ownership:    Light background (#f8fafc)
Privacy:      White background (#ffffff)
Run Your Own: Light background (#f8fafc)
Start:        White background (#ffffff)
Footer:       Deep indigo solid (#1e1b4b)
```

### 3.4 Visual Flow

The page reads as a logical argument:

1. **Hero** — The claim: "Data belongs to you."
2. **Protocol** — The mechanism: four operations, five protocols.
3. **Code** — The proof: working code, three panels, a vertical flow.
4. **Ownership** — The comparison: today vs. B3nd.
5. **Privacy** — The guarantee: encryption flow diagram.
6. **Run Your Own** — The decentralization: node network diagram.
7. **Start Building** — The call to action: four resource cards.

Each section answers the question raised by the previous one.

---

## 4. Component Style

### 4.1 Navigation

```css
nav {
  position: fixed;
  top: 0;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--b3nd-border-light);
  height: 56px;
  z-index: 100;
}
```

- **Fixed position with glass effect.** The nav is always present but never
  heavy. The `backdrop-filter: blur(10px)` creates a frosted-glass effect.
- **Logo:** `b3nd` in 22px/700 weight, primary color. The dot is accent orange.
  This dot is the only orange in the nav.
- **Links:** 14px/500 weight, body text color. Hover transitions to secondary.
- **CTA button:** Secondary background, white text, 6px radius. Hover darkens to
  primary.

### 4.2 Cards

Two card styles exist:

**Resource Cards (`.card`):**

```css
.card {
  background: var(--b3nd-bg-white);
  border: 2px solid var(--b3nd-border-light);
  border-radius: 10px;
  padding: 28px 20px;
  text-align: center;
  transition: all 0.2s;
}
.card:hover {
  border-color: var(--b3nd-secondary);
  transform: translateY(-4px);
  box-shadow: var(--b3nd-shadow-card-hover);
}
```

**Protocol Cards (`.proto-card`):**

```css
.proto-card {
  background: var(--b3nd-bg-white);
  border: 1px solid var(--b3nd-border-light);
  border-radius: 8px;
  padding: 20px;
}
```

- Protocol cards are quieter than resource cards (1px border vs 2px, no hover
  animation). They present information; they do not invite interaction.

### 4.3 Operation Boxes

```css
.op-box {
  background: var(--b3nd-bg-white);
  border: 2px solid var(--b3nd-secondary);
  border-radius: 8px;
  padding: 20px 16px;
  text-align: center;
}
```

- Four boxes in a row. Always four. This is the protocol's fundamental unit.
- The secondary-colored border is thicker (2px) to emphasize these as primary
  structural elements.

### 4.4 Code Blocks

```css
.code-panel {
  background: var(--b3nd-bg-code);
  border-radius: 10px;
  overflow: hidden;
}

.terminal-bar {
  background: rgba(255, 255, 255, 0.06);
  padding: 10px 16px;
}

.code-body {
  padding: 20px;
}

.code-body pre {
  font-family: var(--b3nd-font-code);
  font-size: 13px;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.9);
}
```

- **Terminal chrome:** Three dots (red, yellow, green) at 10px diameter. This is
  the only skeuomorphic element on the entire site, and it exists to signal
  "this is a terminal / code environment."
- **Background:** Near-black with purple tint (`#0f0e1a`), not pure black. This
  connects the code blocks to the indigo palette.

### 4.5 Level Cards (Privacy Section)

```css
.level-card {
  background: var(--b3nd-bg-light);
  border-radius: 8px;
  padding: 24px;
  border-left: 4px solid var(--b3nd-secondary);
}
```

- The left border acts as a visual anchor, creating a column of indigo markers
  down the left side of the privacy grid.

### 4.6 Buttons

```css
/* Primary CTA */
.btn-primary {
  background: var(--b3nd-secondary);
  color: var(--b3nd-text-white);
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: background var(--b3nd-transition-fast);
}
.btn-primary:hover {
  background: var(--b3nd-primary);
}

/* Inline Code CTA */
.code-inline {
  display: inline-block;
  background: var(--b3nd-bg-code);
  color: var(--b3nd-syntax-string);
  font-family: var(--b3nd-font-code);
  font-size: 14px;
  padding: 12px 24px;
  border-radius: 8px;
}
```

### 4.7 Inline SVG Diagrams

SVG diagrams are inline, not external files. They use CSS custom properties for
colors, making them theme-aware. Key rules:

- Strokes are 2px for primary elements, 1px for secondary.
- Text within SVGs uses `font-family: "Inter", sans-serif` by default, with
  `.mono` class for protocol-related labels.
- Fills use low-opacity variants of the palette colors (e.g.,
  `fill-opacity="0.15"`) for highlighted regions.
- Arrow tips use polygon elements, not marker-end, for consistent rendering.

---

## 5. Visual Motifs

### 5.1 The Dot

The orange dot in `b3nd.` is the site's signature element. It appears:

- In the logo (`b3nd<span class="accent">.</span>`)
- In the hero heading
- As the accent stripe at the top of the hero (`height: 3px`)
- As flow arrows between code panels

The dot means "complete" — as in a sentence, a proof, a protocol specification.
It is never used decoratively or at scale.

### 5.2 The URI as Visual Identity

The URI anatomy diagram is not just an illustration — it is the visual identity
of B3nd. The pattern of `protocol:// + hostname + /path` appears repeatedly: in
diagrams, in code blocks, in card links. This repetition builds recognition.

### 5.3 Vertical Flow

Code panels are stacked vertically with arrow connectors between them. This
mirrors the data flow: write, then read, then any app reads. The vertical
orientation is deliberate: it suggests a pipeline, a waterfall, a logical
sequence.

### 5.4 Minimal Node Diagrams

The "Run Your Own" section uses a simple node-and-line diagram. Nodes are
circles. Lines are straight. There are no curved paths, no gradient meshes, no
particle effects. This is a topology diagram, not an illustration.

### 5.5 SVG / Illustration Style

- **Line-based.** No filled illustrations, no gradients on shapes.
- **Geometric.** Circles, rectangles with rounded corners (rx="8"), straight
  lines.
- **Monochrome + one accent.** Most diagrams use secondary (indigo) + muted
  (gray) with selective use of accent (orange) or success (green).
- **Responsive via viewBox.** All SVGs use `viewBox` and percentage-based
  widths. No fixed pixel dimensions on SVG containers.

### 5.6 Animation Philosophy

**Minimal and purposeful.** The B3nd site uses:

- `transition: all 0.2s` on cards (hover lift + border color change)
- `transition: color 0.2s` on nav links
- `scroll-behavior: smooth` on the html element

That is the complete list. No entrance animations. No parallax. No animated
backgrounds. No loading spinners. The site loads, it is there, it is complete.

This restraint communicates confidence. A protocol does not need to perform.

---

## 6. Responsive Behavior

### 6.1 Breakpoints

| Breakpoint       | Changes                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `> 1024px`       | Full layout: 4-column cards, 2-column ownership, 3-column footer                                |
| `768px - 1024px` | Cards go 2-column, ownership goes 1-column, footer goes 1-column                                |
| `< 768px`        | Nav links hidden (mobile CTA appears), ops go 2-column, privacy levels stack, cards go 1-column |

### 6.2 Mobile Navigation

On mobile, the full nav link list is replaced with a single CTA button (GitHub
link). No hamburger menu. No mobile drawer. The nav links reappear in the
footer. This is a documentation site, not an app — mobile users are scanning,
not navigating deeply.

---

## 7. Design Principles (Summary)

1. **Precision over personality.** Every element has a structural reason.
2. **Two fonts, used with discipline.** Inter speaks; JetBrains Mono specifies.
3. **Indigo is trust.** Orange is punctuation, not personality.
4. **White space is structural.** Sections breathe with 80px padding.
5. **Code is content.** Code blocks are first-class citizens, not afterthoughts.
6. **No decoration.** No background patterns, no gradient meshes, no
   illustrations that do not convey information.
7. **The URI is the brand.** If a visual element does not relate to
   `protocol://hostname/path`, question whether it belongs.
