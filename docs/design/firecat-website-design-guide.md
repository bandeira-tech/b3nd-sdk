# Firecat Website Design Guide

**Entity:** Firecat — The Canonical B3nd DePIN Network **Domain:** fire.cat
**Audience:** App developers, node operators, community members, token
participants **Personality:** Alive, economic, community-driven. A network on
fire with activity.

---

## 0. Why Firecat Must Not Look Like B3nd

B3nd is a protocol — a specification document made visual. It is cold, precise,
architectural. It earns trust through restraint.

Firecat is an economy — a living network of people, nodes, tokens, and
applications. It earns trust through vitality. You need to feel that things are
happening, that people are participating, that value is flowing.

If Firecat looked like B3nd, it would feel like a second documentation page for
the same project. Firecat is not a sub-page of B3nd. It is the first real-world
network built on B3nd, and it must have its own gravitational pull.

The differences are structural:

| Dimension         | B3nd                             | Firecat                                   |
| ----------------- | -------------------------------- | ----------------------------------------- |
| Color temperature | Cold (deep indigo)               | Warm (ember/flame spectrum)               |
| Typography mood   | Precise, monospaced accents      | Energetic, bold, wide                     |
| Layout width      | Narrow (1100px), focused         | Wide (1280px), expansive                  |
| Animation         | None. Static proof.              | Present. Living network.                  |
| Visual metaphor   | Blueprint, URI anatomy           | Fire, nodes, flow, economy                |
| Imagery           | Line diagrams, code blocks       | Network visualizations, dashboards        |
| Tone              | "Here is how it works"           | "Join the network"                        |
| Accent usage      | Sparse (orange dot)              | Bold (flame gradients, glowing edges)     |
| Dark mode         | No (light with dark hero/footer) | Yes, dark-first — the fire glows brighter |

---

## 1. Color System

Firecat's palette is built around fire: not cartoon red, but the full spectrum
of combustion. Deep charcoal backgrounds (the furnace), amber and orange
midtones (the flame), bright yellow-white highlights (the hottest point). This
is layered with cool teal accents for contrast — representing the network, the
data flowing through the fire.

### 1.1 Core Palette

| Role                    | Hex       | Usage                                                      |
| ----------------------- | --------- | ---------------------------------------------------------- |
| Primary (Ember)         | `#ea580c` | Primary buttons, active states, key headings on dark       |
| Secondary (Amber)       | `#f59e0b` | Secondary buttons, token/economic highlights, badges       |
| Accent (Teal)           | `#14b8a6` | Network status, node indicators, data-flow elements, links |
| Highlight (Flame White) | `#fef3c7` | Glow effects, highlight text backgrounds on dark           |

### 1.2 Background Colors

| Role                | Hex       | Usage                                          |
| ------------------- | --------- | ---------------------------------------------- |
| Dark Base           | `#0c0a09` | Primary page background (dark mode default)    |
| Dark Surface        | `#1c1917` | Cards, panels, elevated surfaces               |
| Dark Elevated       | `#292524` | Hover states, active cards, secondary surfaces |
| Dark Subtle         | `#44403c` | Borders on dark backgrounds, muted dividers    |
| Light Base          | `#fafaf9` | Light-mode page background (if toggled)        |
| Light Surface       | `#ffffff` | Light-mode cards                               |
| Hero Gradient Start | `#0c0a09` | Radial gradient origin                         |
| Hero Gradient Ember | `#7c2d12` | Radial gradient midpoint — deep ember glow     |
| Hero Gradient End   | `#0c0a09` | Radial gradient edge — fade to dark            |

### 1.3 Text Colors

| Role                      | Hex       | Usage                               |
| ------------------------- | --------- | ----------------------------------- |
| Heading Text (Dark Mode)  | `#fafaf9` | Section titles, card headings       |
| Body Text (Dark Mode)     | `#d6d3d1` | Paragraph text                      |
| Muted Text (Dark Mode)    | `#a8a29e` | Subtitles, captions, timestamps     |
| Dim Text (Dark Mode)      | `#78716c` | Tertiary information, footnotes     |
| Heading Text (Light Mode) | `#1c1917` | Section titles on light backgrounds |
| Body Text (Light Mode)    | `#44403c` | Paragraph text on light backgrounds |
| Muted Text (Light Mode)   | `#78716c` | Subtitles on light backgrounds      |

### 1.4 Token & Economic Colors

Firecat has a dedicated sub-palette for financial and economic information.
These colors are never used decoratively — they carry meaning.

| Role             | Hex       | Usage                                           |
| ---------------- | --------- | ----------------------------------------------- |
| Token Positive   | `#22c55e` | Price up, rewards earned, staking gains         |
| Token Negative   | `#ef4444` | Price down, penalties, warnings                 |
| Token Neutral    | `#f59e0b` | Pending states, current price, FCAT token badge |
| Gas / Throughput | `#14b8a6` | Gas metrics, network throughput, operations/sec |

### 1.5 Semantic Colors

| Role    | Hex       | Usage                                                |
| ------- | --------- | ---------------------------------------------------- |
| Success | `#22c55e` | Transaction confirmed, node online, staking active   |
| Warning | `#f59e0b` | Low balance, approaching limits                      |
| Error   | `#ef4444` | Transaction failed, node offline, insufficient stake |
| Info    | `#3b82f6` | Informational banners, documentation links           |

### 1.6 Glow & Effect Colors

These are used exclusively for CSS effects (box-shadow, text-shadow, radial
gradients). They do not appear as solid fills.

| Role        | Value                                                             | Usage                                              |
| ----------- | ----------------------------------------------------------------- | -------------------------------------------------- |
| Ember Glow  | `rgba(234, 88, 12, 0.3)`                                          | Box-shadow on primary buttons, hover glow on cards |
| Amber Glow  | `rgba(245, 158, 11, 0.2)`                                         | Token badge glow, secondary CTA hover              |
| Teal Glow   | `rgba(20, 184, 166, 0.25)`                                        | Node status indicator glow, network activity       |
| Fire Radial | `radial-gradient(ellipse at 50% 0%, #7c2d12 0%, transparent 70%)` | Hero background atmosphere                         |

### 1.7 CSS Custom Properties

```css
:root {
  /* --- Firecat Core Palette --- */
  --fc-primary: #ea580c;
  --fc-secondary: #f59e0b;
  --fc-accent: #14b8a6;
  --fc-highlight: #fef3c7;

  /* --- Backgrounds (Dark Mode Default) --- */
  --fc-bg-base: #0c0a09;
  --fc-bg-surface: #1c1917;
  --fc-bg-elevated: #292524;
  --fc-bg-subtle: #44403c;
  --fc-bg-hero-start: #0c0a09;
  --fc-bg-hero-ember: #7c2d12;
  --fc-bg-hero-end: #0c0a09;

  /* --- Backgrounds (Light Mode) --- */
  --fc-bg-light-base: #fafaf9;
  --fc-bg-light-surface: #ffffff;

  /* --- Text (Dark Mode) --- */
  --fc-text-heading: #fafaf9;
  --fc-text-body: #d6d3d1;
  --fc-text-muted: #a8a29e;
  --fc-text-dim: #78716c;

  /* --- Text (Light Mode) --- */
  --fc-text-light-heading: #1c1917;
  --fc-text-light-body: #44403c;
  --fc-text-light-muted: #78716c;

  /* --- Token / Economic --- */
  --fc-token-positive: #22c55e;
  --fc-token-negative: #ef4444;
  --fc-token-neutral: #f59e0b;
  --fc-token-gas: #14b8a6;

  /* --- Semantic --- */
  --fc-semantic-success: #22c55e;
  --fc-semantic-warning: #f59e0b;
  --fc-semantic-error: #ef4444;
  --fc-semantic-info: #3b82f6;

  /* --- Glow Effects --- */
  --fc-glow-ember: rgba(234, 88, 12, 0.3);
  --fc-glow-amber: rgba(245, 158, 11, 0.2);
  --fc-glow-teal: rgba(20, 184, 166, 0.25);

  /* --- Borders --- */
  --fc-border-subtle: #292524;
  --fc-border-default: #44403c;
  --fc-border-strong: #78716c;
  --fc-border-ember: rgba(234, 88, 12, 0.4);

  /* --- Shadows --- */
  --fc-shadow-card: 0 2px 8px rgba(0, 0, 0, 0.3);
  --fc-shadow-card-hover:
    0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(234, 88, 12, 0.2);
  --fc-shadow-glow-sm: 0 0 12px var(--fc-glow-ember);
  --fc-shadow-glow-md: 0 0 24px var(--fc-glow-ember);
  --fc-shadow-glow-lg: 0 0 48px var(--fc-glow-ember);

  /* --- Radius --- */
  --fc-radius-sm: 6px;
  --fc-radius-md: 10px;
  --fc-radius-lg: 16px;
  --fc-radius-xl: 24px;
  --fc-radius-full: 9999px;

  /* --- Transitions --- */
  --fc-transition-fast: 0.15s ease;
  --fc-transition-normal: 0.25s ease;
  --fc-transition-slow: 0.4s ease;
  --fc-transition-glow: 0.3s ease;
}

/* --- Light Mode Override --- */
[data-theme="light"] {
  --fc-bg-base: #fafaf9;
  --fc-bg-surface: #ffffff;
  --fc-bg-elevated: #f5f5f4;
  --fc-bg-subtle: #e7e5e4;
  --fc-text-heading: #1c1917;
  --fc-text-body: #44403c;
  --fc-text-muted: #78716c;
  --fc-text-dim: #a8a29e;
  --fc-border-subtle: #e7e5e4;
  --fc-border-default: #d6d3d1;
  --fc-border-strong: #a8a29e;
  --fc-shadow-card: 0 2px 8px rgba(0, 0, 0, 0.08);
  --fc-shadow-card-hover:
    0 8px 32px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(234, 88, 12, 0.3);
}
```

---

## 2. Typography

Firecat uses a different typographic voice than B3nd. Where B3nd is Inter
everywhere (neutral, invisible), Firecat pairs a geometric sans-serif for
headings with a humanist sans-serif for body text, and uses a distinct monospace
for technical content. The heading font has more personality — wider, bolder,
more confident.

### 2.1 Font Families

| Role             | Font          | Fallback Stack               | Why                                                                             |
| ---------------- | ------------- | ---------------------------- | ------------------------------------------------------------------------------- |
| Headings         | Space Grotesk | `sans-serif`                 | Geometric, wide, modern. Feels engineered but warm. Distinct from Inter.        |
| Body             | DM Sans       | `system-ui, sans-serif`      | Clean, slightly rounded, approachable. Better for community content than Inter. |
| Code / Technical | Fira Code     | `Menlo, Consolas, monospace` | Ligatures for code. Visually distinct from JetBrains Mono (B3nd).               |

```css
:root {
  --fc-font-heading: "Space Grotesk", sans-serif;
  --fc-font-body: "DM Sans", system-ui, sans-serif;
  --fc-font-code: "Fira Code", Menlo, Consolas, monospace;
}
```

### 2.2 Font Loading

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link
  href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=DM+Sans:ital,wght@0,400;0,500;0,600;1,400&family=Fira+Code:wght@400;500&display=swap"
  rel="stylesheet"
>
```

### 2.3 Font Scale

The Firecat scale is bolder and more varied than B3nd's. Headings are larger and
weightier. The hero is a statement, not a whisper.

| Level       | Size                       | Weight | Line Height | Letter Spacing | Font          | Usage                                |
| ----------- | -------------------------- | ------ | ----------- | -------------- | ------------- | ------------------------------------ |
| Hero        | `clamp(56px, 10vw, 96px)`  | 700    | 1.0         | `-0.03em`      | Space Grotesk | Hero headline. Full width impact.    |
| H1          | `clamp(36px, 5vw, 52px)`   | 700    | 1.1         | `-0.02em`      | Space Grotesk | Major section headings               |
| H2          | `clamp(24px, 3.5vw, 36px)` | 600    | 1.2         | `-0.01em`      | Space Grotesk | Sub-section headings                 |
| H3          | `20px`                     | 600    | 1.3         | `0`            | Space Grotesk | Card titles, feature names           |
| H4          | `16px`                     | 600    | 1.4         | `0.02em`       | Space Grotesk | Labels, small headings, overlines    |
| Overline    | `12-13px`                  | 600    | 1.4         | `0.1em`        | DM Sans       | Section labels, uppercase pre-titles |
| Body Large  | `18px`                     | 400    | 1.7         | `0`            | DM Sans       | Lead paragraphs, hero subtitle       |
| Body        | `16px`                     | 400    | 1.6         | `0`            | DM Sans       | Standard paragraph text              |
| Body Small  | `14px`                     | 400    | 1.5         | `0`            | DM Sans       | Card descriptions, secondary info    |
| Caption     | `12px`                     | 500    | 1.4         | `0.02em`       | DM Sans       | Timestamps, fine print, metadata     |
| Code        | `14px`                     | 400    | 1.6         | `0`            | Fira Code     | Code blocks, technical content       |
| Code Small  | `12px`                     | 400    | 1.5         | `0`            | Fira Code     | Inline code, terminal output         |
| Token Value | `clamp(28px, 4vw, 40px)`   | 700    | 1.1         | `-0.01em`      | Space Grotesk | FCAT price, staking amounts          |

### 2.4 Typography Rules

1. **Headings are always Space Grotesk.** Body is always DM Sans. Never mix
   them.
2. **Overlines precede major headings.** The pattern is: small uppercase
   overline (e.g., "THE NETWORK") followed by the large heading. This creates a
   rhythmic one-two punch that B3nd never uses.
3. **Italic is allowed** in body text for emphasis. Firecat is a community
   platform; communication can be expressive.
4. **Token values and economic figures** use Space Grotesk at large sizes with
   tabular numbers where possible (font-variant-numeric: tabular-nums).

---

## 3. Layout Philosophy

Where B3nd is a narrow, focused column, Firecat uses the full viewport. The
network is wide. The economy is expansive. The layout should feel like a
dashboard and a landing page had a child.

### 3.1 Grid & Container

```css
.fc-container {
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 32px;
}

.fc-container-wide {
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 32px;
}

.fc-container-narrow {
  max-width: 800px;
  margin: 0 auto;
  padding: 0 32px;
}
```

- **Max width: 1280px** for standard content. Wider than B3nd (1100px) to
  accommodate multi-column layouts, dashboards, and side-by-side comparisons.
- **Wide variant: 1440px** for hero sections and full-bleed visual elements.
- **Narrow variant: 800px** for text-heavy content (blog posts, documentation).
- **Horizontal padding: 32px.** Slightly more generous than B3nd's 24px.

### 3.2 Grid System

Firecat uses a 12-column grid for complex layouts:

```css
.fc-grid {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 24px;
}

/* Common patterns */
.fc-grid-2 {
  grid-template-columns: repeat(2, 1fr);
}
.fc-grid-3 {
  grid-template-columns: repeat(3, 1fr);
}
.fc-grid-4 {
  grid-template-columns: repeat(4, 1fr);
}
```

### 3.3 Section Rhythm

| Element                       | Value                 | Notes                                                  |
| ----------------------------- | --------------------- | ------------------------------------------------------ |
| Section padding               | `96px 0` to `120px 0` | More generous than B3nd's 80px. Sections breathe more. |
| Hero padding                  | `160px 0 120px`       | Taller hero to accommodate the radial glow effect.     |
| Section heading margin-bottom | `56px`                | Slightly more than B3nd.                               |
| Card grid gap                 | `24px`                | Wider than B3nd's 16-20px.                             |
| Overline to heading gap       | `12px`                | Space between overline and heading pair.               |
| Content max-width in sections | `720px` centered      | For single-column text blocks within wide sections.    |

### 3.4 Section Structure

Firecat does NOT alternate white/light like B3nd. Instead, the dark background
is constant, with variation created through:

- **Radial glow accents** behind sections (subtle ember glow emanating from
  section centers)
- **Surface-level cards** that create visual separation
- **Full-bleed feature sections** that break out of the container
- **Horizontal rules** with gradient fades

```
Hero:               Dark base + radial ember glow from center-top
Stats Bar:          Dark surface band, full width
About / Thesis:     Dark base, text-centered, narrow container
Participants:       Dark base, 4-column icon grid
Token Economics:    Dark surface, dashboard-style layout
Node Operators:     Dark base, full-bleed network visualization
For Developers:     Dark base, code examples + SDK cards
Community:          Dark surface, social links + governance
Footer:             Dark base, multi-column, ember gradient top-border
```

### 3.5 Visual Flow

The page reads as an economic pitch, not a technical specification:

1. **Hero** — The vision: "Infrastructure owned by everyone."
2. **Live Stats** — Proof of life: node count, FCAT price, transactions/sec.
3. **The Thesis** — Why this matters: the three problems, the inversion.
4. **Participants** — Who is in the network: operators, builders, users,
   advertisers.
5. **Token Economics** — How value flows: FCAT token, staking, gas, rewards.
6. **Node Operators** — How to join: requirements, rewards, setup guide.
7. **For Developers** — How to build: SDK, APIs, code examples.
8. **Community** — How to connect: governance, social, events.
9. **Footer** — Resources, links, "built on B3nd" attribution.

---

## 4. Component Style

### 4.1 Navigation

```css
.fc-nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  background: rgba(12, 10, 9, 0.85);
  backdrop-filter: blur(16px) saturate(1.2);
  border-bottom: 1px solid var(--fc-border-subtle);
  height: 64px;
  z-index: 100;
}
```

- **Taller than B3nd (64px vs 56px).** Firecat's nav has more presence.
- **Darker glass effect.** The dark-mode glass uses the dark base with high
  blur.
- **Logo:** "FIRECAT" in Space Grotesk 700, with a flame icon (SVG) to the left.
  The logo text uses a subtle gradient from `--fc-primary` to `--fc-secondary`.
- **Active link indicator:** Bottom border in `--fc-primary` (ember), not just a
  color change.
- **Connect Wallet button** in the nav — this is a web3 community site.

```css
.fc-nav-logo {
  font-family: var(--fc-font-heading);
  font-weight: 700;
  font-size: 20px;
  background: linear-gradient(135deg, var(--fc-primary), var(--fc-secondary));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.fc-nav-link {
  font-family: var(--fc-font-body);
  font-size: 14px;
  font-weight: 500;
  color: var(--fc-text-muted);
  transition: color var(--fc-transition-fast);
  padding: 20px 0;
  border-bottom: 2px solid transparent;
}

.fc-nav-link:hover,
.fc-nav-link.active {
  color: var(--fc-text-heading);
  border-bottom-color: var(--fc-primary);
}

.fc-nav-cta {
  background: var(--fc-primary);
  color: white;
  padding: 8px 20px;
  border-radius: var(--fc-radius-full);
  font-family: var(--fc-font-body);
  font-size: 14px;
  font-weight: 600;
  transition: all var(--fc-transition-fast);
}

.fc-nav-cta:hover {
  box-shadow: var(--fc-shadow-glow-sm);
  transform: translateY(-1px);
}
```

### 4.2 Cards

Firecat cards have more depth and interactivity than B3nd cards. They exist on
dark surfaces and use border glow effects on hover.

```css
.fc-card {
  background: var(--fc-bg-surface);
  border: 1px solid var(--fc-border-subtle);
  border-radius: var(--fc-radius-lg);
  padding: 32px;
  transition: all var(--fc-transition-normal);
}

.fc-card:hover {
  border-color: var(--fc-border-ember);
  box-shadow: var(--fc-shadow-card-hover);
  transform: translateY(-2px);
}

/* Feature card with icon */
.fc-card-feature {
  background: var(--fc-bg-surface);
  border: 1px solid var(--fc-border-subtle);
  border-radius: var(--fc-radius-lg);
  padding: 32px;
  position: relative;
  overflow: hidden;
}

.fc-card-feature::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, var(--fc-primary), var(--fc-secondary));
  opacity: 0;
  transition: opacity var(--fc-transition-normal);
}

.fc-card-feature:hover::before {
  opacity: 1;
}

/* Stats card */
.fc-card-stat {
  background: var(--fc-bg-surface);
  border: 1px solid var(--fc-border-subtle);
  border-radius: var(--fc-radius-md);
  padding: 24px;
  text-align: center;
}

.fc-card-stat .value {
  font-family: var(--fc-font-heading);
  font-size: clamp(28px, 4vw, 40px);
  font-weight: 700;
  color: var(--fc-text-heading);
  font-variant-numeric: tabular-nums;
}

.fc-card-stat .label {
  font-family: var(--fc-font-body);
  font-size: 13px;
  font-weight: 500;
  color: var(--fc-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-top: 8px;
}
```

### 4.3 Buttons

Firecat buttons are more expressive than B3nd's. They glow, they have pill
shapes, they announce themselves.

```css
/* Primary button — ember */
.fc-btn-primary {
  background: var(--fc-primary);
  color: white;
  font-family: var(--fc-font-body);
  font-size: 15px;
  font-weight: 600;
  padding: 12px 28px;
  border-radius: var(--fc-radius-full);
  border: none;
  cursor: pointer;
  transition: all var(--fc-transition-fast);
}

.fc-btn-primary:hover {
  background: #c2410c; /* darker ember */
  box-shadow: var(--fc-shadow-glow-sm);
  transform: translateY(-1px);
}

.fc-btn-primary:active {
  transform: translateY(0);
  box-shadow: none;
}

/* Secondary button — outline */
.fc-btn-secondary {
  background: transparent;
  color: var(--fc-text-heading);
  font-family: var(--fc-font-body);
  font-size: 15px;
  font-weight: 600;
  padding: 12px 28px;
  border-radius: var(--fc-radius-full);
  border: 1.5px solid var(--fc-border-default);
  cursor: pointer;
  transition: all var(--fc-transition-fast);
}

.fc-btn-secondary:hover {
  border-color: var(--fc-primary);
  color: var(--fc-primary);
}

/* Ghost button — text only */
.fc-btn-ghost {
  background: transparent;
  color: var(--fc-accent);
  font-family: var(--fc-font-body);
  font-size: 14px;
  font-weight: 500;
  padding: 8px 16px;
  border-radius: var(--fc-radius-sm);
  border: none;
  cursor: pointer;
  transition: all var(--fc-transition-fast);
}

.fc-btn-ghost:hover {
  background: rgba(20, 184, 166, 0.1);
}
```

### 4.4 Code Blocks

Firecat code blocks serve a different purpose than B3nd's. In B3nd, code IS the
content. In Firecat, code is SDK documentation — it supports the economic
narrative, it does not lead it.

```css
.fc-code-block {
  background: #0a0a0a;
  border: 1px solid var(--fc-border-subtle);
  border-radius: var(--fc-radius-md);
  overflow: hidden;
}

.fc-code-header {
  background: rgba(255, 255, 255, 0.03);
  padding: 12px 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--fc-border-subtle);
}

.fc-code-header .language {
  font-family: var(--fc-font-code);
  font-size: 12px;
  color: var(--fc-text-dim);
}

.fc-code-header .copy-btn {
  font-family: var(--fc-font-body);
  font-size: 12px;
  color: var(--fc-text-dim);
  background: none;
  border: 1px solid var(--fc-border-subtle);
  border-radius: var(--fc-radius-sm);
  padding: 4px 10px;
  cursor: pointer;
  transition: all var(--fc-transition-fast);
}

.fc-code-header .copy-btn:hover {
  color: var(--fc-accent);
  border-color: var(--fc-accent);
}

.fc-code-body {
  padding: 20px;
}

.fc-code-body pre {
  font-family: var(--fc-font-code);
  font-size: 14px;
  line-height: 1.6;
  color: #e7e5e4;
}

/* Syntax colors (distinct from B3nd) */
.fc-syn-keyword {
  color: #f472b6;
} /* pink — different from B3nd's purple */
.fc-syn-string {
  color: #34d399;
} /* emerald */
.fc-syn-function {
  color: #60a5fa;
} /* blue */
.fc-syn-comment {
  color: #57534e;
} /* stone */
.fc-syn-number {
  color: #fbbf24;
} /* amber — token values! */
.fc-syn-type {
  color: #a78bfa;
} /* violet */
```

### 4.5 Token / Economic Components

These components are unique to Firecat. B3nd has nothing like them.

```css
/* Token badge */
.fc-token-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: var(--fc-radius-full);
  padding: 4px 12px 4px 8px;
  font-family: var(--fc-font-code);
  font-size: 13px;
  color: var(--fc-secondary);
}

.fc-token-badge .icon {
  width: 16px;
  height: 16px;
}

/* Live stat ticker */
.fc-stat-ticker {
  font-family: var(--fc-font-heading);
  font-variant-numeric: tabular-nums;
  color: var(--fc-text-heading);
}

.fc-stat-ticker.positive {
  color: var(--fc-token-positive);
}
.fc-stat-ticker.negative {
  color: var(--fc-token-negative);
}

/* Staking meter */
.fc-staking-meter {
  height: 8px;
  background: var(--fc-bg-elevated);
  border-radius: var(--fc-radius-full);
  overflow: hidden;
}

.fc-staking-meter .fill {
  height: 100%;
  background: linear-gradient(90deg, var(--fc-primary), var(--fc-secondary));
  border-radius: var(--fc-radius-full);
  transition: width var(--fc-transition-slow);
}
```

### 4.6 Node Status Indicators

```css
.fc-node-status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--fc-font-body);
  font-size: 13px;
}

.fc-node-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.fc-node-dot.online {
  background: var(--fc-semantic-success);
  box-shadow: 0 0 8px rgba(34, 197, 94, 0.5);
}

.fc-node-dot.syncing {
  background: var(--fc-semantic-warning);
  box-shadow: 0 0 8px rgba(245, 158, 11, 0.5);
  animation: fc-pulse 2s ease-in-out infinite;
}

.fc-node-dot.offline {
  background: var(--fc-semantic-error);
}

@keyframes fc-pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}
```

### 4.7 Tables (Economic Data)

```css
.fc-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-family: var(--fc-font-body);
  font-size: 14px;
}

.fc-table thead th {
  font-weight: 600;
  color: var(--fc-text-muted);
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 0.08em;
  padding: 12px 16px;
  border-bottom: 1px solid var(--fc-border-default);
  text-align: left;
}

.fc-table tbody td {
  padding: 14px 16px;
  color: var(--fc-text-body);
  border-bottom: 1px solid var(--fc-border-subtle);
}

.fc-table tbody tr:hover {
  background: rgba(255, 255, 255, 0.02);
}

.fc-table .mono {
  font-family: var(--fc-font-code);
  font-size: 13px;
}
```

---

## 5. Visual Motifs

### 5.1 The Flame / Ember Glow

The defining visual element of Firecat is a radial ember glow — a warm, diffused
light source that appears behind the hero, behind key sections, and as hover
effects. This is not a literal fire illustration. It is an atmospheric effect: a
radial gradient from deep ember (`#7c2d12`) to transparent, placed
strategically.

```css
.fc-ember-glow {
  position: absolute;
  width: 600px;
  height: 400px;
  background: radial-gradient(
    ellipse at center,
    rgba(124, 45, 18, 0.4) 0%,
    rgba(124, 45, 18, 0.1) 40%,
    transparent 70%
  );
  pointer-events: none;
  z-index: 0;
}
```

This glow is always behind content, never in front. It creates warmth without
competing with text readability.

### 5.2 Network Topology Visualizations

Where B3nd uses static node-and-line diagrams, Firecat uses animated network
visualizations:

- **Nodes pulse** gently to indicate liveness
- **Connection lines** have gradient strokes (ember to teal) showing data flow
  direction
- **New nodes** appear with a brief scale-in animation
- **Data packets** are tiny dots that travel along connection lines

These visualizations are canvas-based or SVG with CSS animations, not heavy
JavaScript frameworks. They should be decorative but meaningful — showing an
approximation of actual network topology if possible.

### 5.3 The "Built on B3nd" Attribution

Every Firecat page includes a small, tasteful attribution: "Built on B3nd" with
a link to b3nd.dev. This uses B3nd's indigo (`#4338ca`) for the text color — a
deliberate visual bridge. It appears in the footer, never in the main content
flow.

```css
.fc-built-on-b3nd {
  font-family: var(--fc-font-code);
  font-size: 12px;
  color: #4338ca; /* B3nd's secondary — the one color shared between sites */
  opacity: 0.7;
  transition: opacity var(--fc-transition-fast);
}

.fc-built-on-b3nd:hover {
  opacity: 1;
}
```

### 5.4 Gradient Top-Borders

Instead of B3nd's solid accent stripe, Firecat uses gradient borders on cards,
sections, and feature highlights:

```css
.fc-gradient-border-top {
  position: relative;
}

.fc-gradient-border-top::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(
    90deg,
    var(--fc-primary),
    var(--fc-secondary),
    var(--fc-accent)
  );
}
```

This three-color gradient (ember -> amber -> teal) represents the full Firecat
economy: infrastructure (ember), value (amber), and data/network (teal).

### 5.5 SVG / Illustration Style

- **Filled shapes with low opacity.** Unlike B3nd's line-only approach, Firecat
  uses filled circles and rounded rectangles with 10-20% opacity fills.
- **Gradient strokes.** Connection lines use gradients, not solid colors.
- **Rounded, organic.** Higher border-radius values. More circular elements. The
  network is organic, not architectural.
- **Warm color dominance.** Ember and amber dominate illustrations, with teal as
  the counterpoint.

### 5.6 Animation Philosophy

**Present and purposeful.** Firecat uses animation to communicate liveness:

- **Entrance animations:** Elements fade-in and translate-up on scroll
  (`opacity: 0 -> 1`, `translateY(20px) -> 0`). Duration: 0.4-0.6s with
  staggered delays for grid items.
- **Hover states:** Cards lift (translateY), borders glow, buttons pulse subtly.
- **Live indicators:** Node status dots pulse. Stat numbers count up on first
  view. Network visualizations animate continuously but subtly.
- **No parallax.** No scroll-jacking. No auto-playing video. Animations enhance;
  they do not distract.

```css
/* Scroll-triggered entrance */
.fc-fade-up {
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 0.5s ease, transform 0.5s ease;
}

.fc-fade-up.visible {
  opacity: 1;
  transform: translateY(0);
}

/* Stagger delays for grids */
.fc-stagger-1 {
  transition-delay: 0.05s;
}
.fc-stagger-2 {
  transition-delay: 0.10s;
}
.fc-stagger-3 {
  transition-delay: 0.15s;
}
.fc-stagger-4 {
  transition-delay: 0.20s;
}
```

---

## 6. Responsive Behavior

### 6.1 Breakpoints

| Breakpoint        | Changes                                                       |
| ----------------- | ------------------------------------------------------------- |
| `> 1280px`        | Full layout: 4-column grids, wide hero, dashboard sections    |
| `1024px - 1280px` | 3-column grids, slightly tighter spacing                      |
| `768px - 1024px`  | 2-column grids, stacked hero text, simplified nav             |
| `< 768px`         | 1-column, hamburger menu, stacked stats, reduced glow effects |

### 6.2 Mobile Navigation

Firecat uses a hamburger menu on mobile that opens a full-screen overlay in
`--fc-bg-base` with large tap targets. This is different from B3nd (which just
hides the nav) because Firecat has more navigation destinations and includes a
wallet connection flow.

```css
.fc-mobile-menu {
  position: fixed;
  inset: 0;
  background: var(--fc-bg-base);
  z-index: 200;
  padding: 80px 32px 32px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.fc-mobile-menu a {
  font-family: var(--fc-font-heading);
  font-size: 24px;
  font-weight: 600;
  color: var(--fc-text-heading);
  padding: 16px 0;
  border-bottom: 1px solid var(--fc-border-subtle);
}
```

### 6.3 Performance on Mobile

- **Reduce glow effects** below 768px (remove radial gradients or reduce their
  size/opacity). These are GPU-intensive on lower-end devices.
- **Disable network visualization animations** on `prefers-reduced-motion`.
- **Lazy-load below-fold sections** including the network topology canvas.

---

## 7. Theme Toggle (Dark / Light)

Firecat is **dark-first** — the dark theme is the default and primary design. A
light mode toggle is provided for accessibility and user preference, but all
design decisions are made dark-first and adapted to light, not the reverse.

This is the opposite of B3nd, which is light-first with a dark hero.

```css
/* Toggle mechanism */
[data-theme="light"] {
  /* See Section 1.7 for light mode overrides */
}

/* Media query fallback */
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    /* Apply light mode overrides */
  }
}
```

---

## 8. Design Principles (Summary)

1. **Warmth over coldness.** Firecat is a community, not a specification.
2. **Dark-first.** The fire glows brighter against darkness.
3. **Economic clarity.** Token values, staking meters, and network stats are
   first-class UI citizens with dedicated component styles.
4. **Liveness.** The site should feel like a network that is running right now.
   Pulse animations, live stats, and network visualizations communicate
   activity.
5. **Distinct from B3nd.** Different fonts, different colors, different layout
   width, different animation philosophy. The only shared element is the "Built
   on B3nd" attribution in indigo.
6. **Accessible despite dark mode.** All text meets WCAG AA contrast ratios
   against dark backgrounds. Glow effects are decorative, not informational.
7. **The gradient is the brand.** Ember -> amber -> teal represents the full
   economy: infrastructure, value, network.
