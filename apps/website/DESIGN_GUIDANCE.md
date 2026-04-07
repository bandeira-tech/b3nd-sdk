# Design Guidance: B3nd & Firecat

Two distinct digital identities. One infrastructure layer, one ecosystem layer.
This document defines the visual language, component specifications, and design
philosophy for each so they are unmistakably separate entities that nonetheless
share a world.

---

## Table of Contents

1. [B3nd Website Design Direction](#1-b3nd-website-design-direction)
2. [Firecat Website Design Direction](#2-firecat-website-design-direction)
3. [Component Specifications](#3-component-specifications)
4. [Contrast Report](#4-contrast-report)

---

## 1. B3nd Website Design Direction

**Design Metaphor:** _"The protocol is a blueprint"_ -- architectural,
structural, precise. Every element on the page should feel like it was placed by
an engineer who cares about aesthetics. Think of a technical drawing that
happens to be beautiful.

### 1.1 Color System

The current palette is strong but can be refined for deeper sophistication. The
indigo base stays; the supporting cast gets more intentional.

#### Primary Palette

| Role                          | Hex       | Usage                                                                    | WCAG Notes                                                           |
| ----------------------------- | --------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| **Deep Indigo** (Primary)     | `#1a1747` | Hero backgrounds, footer, primary surfaces                               | --                                                                   |
| **Indigo** (Secondary)        | `#4f46e5` | Interactive elements, links, borders, accents                            | 4.56:1 on white (AA pass)                                            |
| **Orange Accent**             | `#f97316` | Punctuation mark in logo, key call-to-action highlights, diagram accents | 3.03:1 on white (use only on large text/icons, or pair with dark bg) |
| **Emerald** (Success/Network) | `#10b981` | Success states, network diagrams, positive indicators                    | 3.24:1 on white (large text only); 8.5:1 on `#1a1747`                |

#### Neutral Palette

| Role          | Hex       | Usage                             |
| ------------- | --------- | --------------------------------- |
| **White**     | `#ffffff` | Page background, card backgrounds |
| **Snow**      | `#f8fafc` | Alternate section backgrounds     |
| **Smoke**     | `#f1f5f9` | Hover states, subtle fills        |
| **Slate 300** | `#cbd5e1` | Borders, dividers                 |
| **Slate 500** | `#64748b` | Muted/secondary text              |
| **Slate 700** | `#334155` | Body text                         |
| **Slate 900** | `#0f172a` | Headings, high-emphasis text      |

#### Code Block Palette

| Role                | Hex                         | Usage                                                                  |
| ------------------- | --------------------------- | ---------------------------------------------------------------------- |
| **Code Background** | `#0c0b18`                   | Terminal/code panel background (darker than current for more contrast) |
| **Code Surface**    | `#161428`                   | Terminal title bar, slightly lighter than background                   |
| **Keyword Purple**  | `#c084fc`                   | Language keywords (`await`, `const`, `import`)                         |
| **String Green**    | `#86efac`                   | String literals                                                        |
| **Function Blue**   | `#93c5fd`                   | Function names and method calls                                        |
| **Comment**         | `rgba(255, 255, 255, 0.30)` | Inline comments                                                        |
| **Punctuation**     | `rgba(255, 255, 255, 0.55)` | Brackets, semicolons, operators                                        |
| **Plain Text**      | `rgba(255, 255, 255, 0.88)` | Default code text                                                      |

#### Accessibility Notes

- All body text (`#334155` on `#ffffff`) achieves a contrast ratio of 9.3:1
  (AAA).
- Section headings (`#0f172a` on `#ffffff`) achieve 17.4:1 (AAA).
- Interactive indigo (`#4f46e5` on `#ffffff`) achieves 4.56:1 (AA for normal
  text, AAA for large text).
- Orange accent should never be used for small body text on white. Reserve for
  icons, large headings, or decorative elements. On dark backgrounds
  (`#1a1747`), orange achieves 7.2:1 (AAA).
- Muted text (`#64748b` on `#ffffff`) achieves 4.64:1 (AA).

### 1.2 Typography

#### Font Stack

| Role                 | Font           | Fallback                                                  |
| -------------------- | -------------- | --------------------------------------------------------- |
| **Headings & Body**  | Inter          | -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif |
| **Code & Technical** | JetBrains Mono | "Fira Code", "Source Code Pro", monospace                 |

#### Type Scale

| Element                | Size                       | Weight     | Line Height | Letter Spacing | Notes                             |
| ---------------------- | -------------------------- | ---------- | ----------- | -------------- | --------------------------------- |
| **Display (Hero H1)**  | `clamp(64px, 12vw, 120px)` | 700        | 1.0         | -0.03em        | Used only once per page           |
| **H1 (Page Title)**    | `clamp(36px, 5vw, 48px)`   | 700        | 1.15        | -0.02em        | Section anchors                   |
| **H2 (Section Title)** | `clamp(28px, 4vw, 36px)`   | 700        | 1.2         | -0.015em       | Primary section headers           |
| **H3 (Card Title)**    | `18px`                     | 600        | 1.3         | -0.01em        | Card and subsection headers       |
| **H4 (Label)**         | `14px`                     | 600        | 1.4         | 0.02em         | Footer headers, small labels      |
| **Body**               | `16px`                     | 400        | 1.65        | 0              | Default paragraph text            |
| **Body Small**         | `14px`                     | 400        | 1.6         | 0              | Descriptions, secondary text      |
| **Caption**            | `13px`                     | 400        | 1.5         | 0.01em         | Annotations, fine print           |
| **Code Inline**        | `14px`                     | 400 (mono) | 1.5         | 0              | Inline code references            |
| **Code Block**         | `13px`                     | 400 (mono) | 1.7         | 0              | Terminal/code panels              |
| **Code Label**         | `12px`                     | 400 (mono) | 1.4         | 0.04em         | Terminal bar labels               |
| **Tagline**            | `clamp(16px, 2.5vw, 22px)` | 400        | 1.4         | 0.15em         | Hero sub-line, lowercase tracking |

#### Weight Distribution Philosophy

- **700 (Bold):** Headlines only. Creates clear visual hierarchy without
  shouting.
- **600 (SemiBold):** Card titles, navigation emphasis, buttons. The "confident"
  weight.
- **500 (Medium):** Navigation links, labels. Subtle emphasis without heaviness.
- **400 (Regular):** Body copy, descriptions, code. Workhorse weight.

Avoid using 300 or lighter. B3nd's personality is confident; light weights
undermine that.

### 1.3 Layout Principles

#### Grid System

- **Max content width:** `1100px` (current, retained -- slightly narrower than
  typical to enforce dense, focused reading)
- **Padding (horizontal):** `24px` at all breakpoints, increasing to `32px`
  above `1280px`
- **Column grid:** 12-column grid with `20px` gutters for internal layout
- **Code panels:** Max width `700px`, centered within the content area

#### Whitespace Philosophy: Generous but Structured

B3nd's whitespace is architectural. It is not decorative negative space; it is
load-bearing. Every gap has a reason.

- **Section padding:** `80px` top and bottom (vertically generous, horizontally
  constrained)
- **Between section title and content:** `48px`
- **Between cards in a grid:** `16px-20px` (tight, implying these items are a
  unit)
- **Between major content blocks within a section:** `40px`
- **Paragraph spacing:** `1.65` line-height with `16px` margin-bottom

#### Section Rhythm

Sections alternate between white (`#ffffff`) and snow (`#f8fafc`) backgrounds.
This creates a subtle visual cadence without resorting to heavy borders or
dividers.

Pattern:
`Hero (dark) > Light section > White section > Light section > White section > ... > Footer (dark)`

Every section is self-contained. A reader should be able to screenshot any
single section and it should look complete.

#### Content Width Constraints

| Content Type     | Max Width                        |
| ---------------- | -------------------------------- |
| Full layout      | `1100px`                         |
| Prose/paragraphs | `700px` (centered)               |
| Code panels      | `700px` (centered)               |
| SVG diagrams     | `100%` of container (responsive) |
| Card grids       | `100%` of container              |

### 1.4 Visual Language

#### SVG Diagram Style Guide

Diagrams are B3nd's signature. They should look like they belong in a
well-typeset technical paper.

- **Stroke weight:** `2px` for primary elements, `1px` for secondary/connecting
  lines
- **Corner radius:** `8px` on rectangles (matches card radius)
- **Text inside SVGs:** Use Inter for labels, JetBrains Mono (class `.mono`) for
  code/protocol references
- **Colors in diagrams:** Pull from the CSS custom properties
  (`var(--secondary)`, `var(--accent)`, etc.)
- **Arrow style:** Filled polygon heads, `2px` stroke, colored by semantic
  meaning (accent for flow, muted for passive connections, emerald for
  positive/network)
- **Dashed lines:** `stroke-dasharray="5,5"` for implied or future connections
- **Labeling:** Below or beside the element, `11px` font-size, muted color
- **Responsive behavior:** Use `viewBox` and `width: 100%` with `height: auto`
- **No drop shadows on SVG elements.** Keep diagrams flat and technical.

#### Code Panel Design

Code panels are terminal-styled windows. They are a stage for the protocol to
perform.

- **Background:** `#0c0b18`
- **Border radius:** `10px`
- **Terminal bar:** `rgba(255, 255, 255, 0.06)` background, `10px 16px` padding
- **Traffic light dots:** 10px diameter circles (`#ef4444`, `#f59e0b`,
  `#10b981`)
- **Terminal label:** JetBrains Mono, `12px`, `rgba(255, 255, 255, 0.4)`,
  tracking `0.04em`
- **Code body padding:** `20px`
- **Overflow:** `overflow-x: auto` with no visible scrollbar styling (use
  webkit-scrollbar hiding)
- **No line numbers** unless displaying a file (inline examples omit them)

#### Card / Component Patterns

- **Border:** `2px solid #e5e7eb` (resting), `2px solid var(--secondary)`
  (hover)
- **Border radius:** `10px` for cards, `8px` for smaller elements (op-boxes,
  level cards)
- **Padding:** `28px 20px` for full cards, `20px` for compact cards
- **Hover behavior:** `translateY(-4px)` +
  `box-shadow: 0 8px 24px rgba(79, 70, 229, 0.10)`
- **Transition:** `all 0.2s ease`
- **No gradients on cards.** Flat, clean surfaces.
- **Accent indicators:** `4px` left-border in secondary color for emphasis cards
  (privacy level cards)

#### Animation Philosophy: Minimal and Purposeful

Animation in B3nd exists to clarify, not to decorate. The protocol is precise;
its animations should be too.

- **Allowed animations:**
  - Hover state transitions (`0.2s ease` on color, transform, box-shadow)
  - Scroll-triggered fade-in for sections (`opacity 0 > 1`,
    `translateY(12px > 0)`, `0.4s ease-out`)
  - Subtle pulse on network node diagrams (optional, `2s ease infinite`, scale
    1.0 > 1.02)
- **Forbidden animations:**
  - Parallax scrolling
  - Auto-playing carousels
  - Bouncing elements
  - Typing/typewriter effects
  - Any animation longer than `0.6s` on user-triggered actions
- **Reduced motion:** Respect `prefers-reduced-motion: reduce`. All animations
  must have a static fallback.

#### Icon Style

- **Style:** Outline/stroke-based, `2px` stroke width, `24px` default size
- **Source:** Lucide icons or hand-drawn SVGs matching Lucide's geometry
- **Color:** Inherit from context (usually `currentColor` or `var(--muted)`)
- **No filled icons.** B3nd is about structure, not mass.
- **No emoji as icons.** Ever.

---

## 2. Firecat Website Design Direction

**Design Metaphor:** _"A living network"_ -- organic growth, energy flow,
community constellation. The site should feel like you are watching a network
breathe. Where B3nd is a blueprint, Firecat is the city built from it -- alive,
humming, populated.

**Domain:** `fire.cat`

### 2.1 Color System

Firecat's palette is entirely distinct from B3nd. Where B3nd is cool indigo,
Firecat is warm and radiant. The palette draws from flame -- not cartoonish
fire, but the sophisticated warmth of ember, amber, and heated metal.

#### Primary Palette

| Role                      | Hex       | Usage                                                  | WCAG Notes                                                                     |
| ------------------------- | --------- | ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| **Flame 600** (Primary)   | `#dc4a1a` | Primary buttons, logo, key interactive elements        | 4.62:1 on white (AA); 5.8:1 on `#fffbf5`                                       |
| **Amber 500** (Secondary) | `#d97706` | Secondary buttons, highlights, token/economic emphasis | 3.56:1 on white (large text/icons only); use on dark backgrounds for body text |
| **Scarlet 800** (Deep)    | `#7c1d1d` | Footer background, deep UI surfaces, dark sections     | --                                                                             |
| **Ember 900** (Darkest)   | `#451a03` | Text on light backgrounds, maximum emphasis            | 15.4:1 on white (AAA)                                                          |
| **Solar Yellow**          | `#fbbf24` | Highlights, badges, reward indicators, sparks          | Decorative use only; never for text on light backgrounds                       |

#### Neutral Palette (Warm-shifted)

| Role              | Hex       | Usage                                        |
| ----------------- | --------- | -------------------------------------------- |
| **Cream**         | `#fffbf5` | Page background (warm white, NOT cool white) |
| **Sand**          | `#fef3e2` | Alternate section backgrounds                |
| **Warm Gray 200** | `#e8e0d8` | Borders, dividers                            |
| **Warm Gray 500** | `#8a7e72` | Muted/secondary text                         |
| **Warm Gray 700** | `#4a4139` | Body text                                    |
| **Warm Gray 900** | `#1c1610` | Headings, high-emphasis text                 |

#### Highlight / State Colors

| Role            | Hex       | Usage                                          |
| --------------- | --------- | ---------------------------------------------- |
| **Node Green**  | `#22c55e` | Active nodes, online status, health indicators |
| **Reward Gold** | `#eab308` | Token rewards, staking highlights              |
| **Alert Red**   | `#ef4444` | Errors, warnings (used sparingly)              |
| **Info Teal**   | `#14b8a6` | Informational callouts, secondary data         |

#### Code Block Palette (Warm Terminal)

| Role                | Hex                         | Usage                                  |
| ------------------- | --------------------------- | -------------------------------------- |
| **Code Background** | `#1a1008`                   | Terminal background (warm-tinted dark) |
| **Code Surface**    | `#261c10`                   | Terminal title bar                     |
| **Keyword Orange**  | `#fb923c`                   | Language keywords                      |
| **String Amber**    | `#fcd34d`                   | String literals                        |
| **Function Cream**  | `#fef3c7`                   | Function names                         |
| **Comment**         | `rgba(255, 255, 255, 0.30)` | Inline comments                        |
| **Plain Text**      | `rgba(255, 245, 230, 0.88)` | Default code text                      |

#### Accessibility Notes

- Body text (`#4a4139` on `#fffbf5`) achieves 8.8:1 (AAA).
- Headings (`#1c1610` on `#fffbf5`) achieve 16.9:1 (AAA).
- Primary flame (`#dc4a1a` on `#fffbf5`) achieves 4.62:1 (AA normal text, AAA
  large text).
- Muted text (`#8a7e72` on `#fffbf5`) achieves 4.2:1 (AA).
- Solar yellow (`#fbbf24`) must never carry meaning alone -- always pair with
  text or icon.

### 2.2 Typography

Firecat uses a different type system from B3nd to establish visual independence.
The fonts feel more dynamic and contemporary.

#### Font Stack

| Role         | Font              | Fallback                                  | Notes                                                                                |
| ------------ | ----------------- | ----------------------------------------- | ------------------------------------------------------------------------------------ |
| **Headings** | **Space Grotesk** | Inter, -apple-system, sans-serif          | Geometric sans with distinctive character; optical-sizing feels modern and energetic |
| **Body**     | **DM Sans**       | Inter, -apple-system, sans-serif          | Clean, warm humanist sans-serif; highly legible, friendlier than Inter               |
| **Code**     | JetBrains Mono    | "Fira Code", "Source Code Pro", monospace | Shared with B3nd for code sections (continuity in technical contexts)                |

**Why these fonts:**

- Space Grotesk has the geometric confidence of a tech brand but with enough
  quirk (the `a`, `g`, `t` letterforms) to feel alive rather than sterile. It
  signals "modern network" without feeling like a clone of B3nd's Inter.
- DM Sans is rounder and warmer than Inter, creating an approachable body text
  that matches Firecat's community personality.

#### Type Scale

| Element            | Size                      | Weight     | Line Height | Letter Spacing | Font                     |
| ------------------ | ------------------------- | ---------- | ----------- | -------------- | ------------------------ |
| **Display (Hero)** | `clamp(48px, 10vw, 96px)` | 700        | 1.05        | -0.03em        | Space Grotesk            |
| **H1**             | `clamp(32px, 5vw, 44px)`  | 700        | 1.15        | -0.02em        | Space Grotesk            |
| **H2**             | `clamp(26px, 4vw, 34px)`  | 700        | 1.2         | -0.01em        | Space Grotesk            |
| **H3**             | `20px`                    | 600        | 1.3         | 0              | Space Grotesk            |
| **H4**             | `16px`                    | 600        | 1.4         | 0.01em         | Space Grotesk            |
| **Body**           | `16px`                    | 400        | 1.7         | 0              | DM Sans                  |
| **Body Small**     | `14px`                    | 400        | 1.6         | 0              | DM Sans                  |
| **Caption**        | `13px`                    | 500        | 1.5         | 0.02em         | DM Sans                  |
| **Badge/Tag**      | `12px`                    | 700        | 1.0         | 0.06em         | Space Grotesk, uppercase |
| **Code Block**     | `13px`                    | 400 (mono) | 1.7         | 0              | JetBrains Mono           |

#### Weight Distribution Philosophy

- **700 (Bold):** Headlines and badges. Firecat is bold; its headings should
  hit.
- **600 (SemiBold):** Subheadings, card titles, navigation. Energetic without
  heaviness.
- **500 (Medium):** Emphasis within body text, captions, labels.
- **400 (Regular):** Body copy, descriptions.
- **300 (Light):** Can be used sparingly for very large decorative numbers
  (e.g., tokenomics statistics). Where B3nd avoids 300, Firecat can use it for
  contrast at display sizes.

### 2.3 Layout Principles

#### Grid System

- **Max content width:** `1280px` (wider than B3nd -- Firecat's content breathes
  more horizontally)
- **Padding (horizontal):** `24px` mobile, `32px` tablet, `48px` desktop
- **Column grid:** 12-column grid with `24px` gutters (wider than B3nd for more
  breathing room)
- **Hero sections:** Full-viewport width with edge-to-edge background treatments

#### Whitespace Philosophy: Dynamic and Expansive

Where B3nd's whitespace is structural, Firecat's is expansive. It creates room
for the network to feel alive.

- **Section padding:** `96px` top and bottom (more vertical breathing than B3nd)
- **Between section title and content:** `56px`
- **Between cards in a grid:** `24px` (slightly more generous than B3nd)
- **Between major content blocks:** `48px`
- **Paragraph spacing:** `1.7` line-height with `20px` margin-bottom

#### Layout Patterns

Firecat uses more dynamic, asymmetric layouts than B3nd:

- **Split hero:** 60/40 text-to-visual split on desktop (not centered like B3nd)
- **Offset grids:** Content blocks that break the grid slightly for visual
  energy
- **Card-based tokenomics:** 3-column card grids for economic model sections
- **Flow diagrams:** Full-width horizontal flow layouts for token circulation
- **Testimonial/community strips:** Full-width scrolling or stacked community
  proof
- **Staggered reveals:** Alternating left-right content blocks for feature
  explanations

#### Section Rhythm

Pattern:
`Hero (full-width, dramatic) > Sand section > Cream section > Dark section (scarlet) > Sand > Cream > ... > Footer (deep scarlet)`

Unlike B3nd's subtle alternation, Firecat punctuates with occasional dark
sections to create dramatic rhythm changes. These dark sections (scarlet/ember
backgrounds with light text) are used for high-impact moments: tokenomics
summary, community stats, key CTAs.

#### Content Width Constraints

| Content Type     | Max Width                                          |
| ---------------- | -------------------------------------------------- |
| Full layout      | `1280px`                                           |
| Prose/paragraphs | `720px` (centered or left-aligned in split layout) |
| Code panels      | `680px`                                            |
| Card grids       | `100%` of container                                |
| Hero content     | `560px` for text block in split layout             |
| Stat banners     | Full container width                               |

### 2.4 Visual Language

#### Network / Node Visualizations

Firecat's signature visual element is the network graph -- nodes connected by
flowing lines.

- **Node representation:** Circles with soft glows, `3px` stroke, filled with a
  translucent version of the node's category color
- **Connection lines:** `1.5px` strokes with subtle animated dash patterns
  (`stroke-dasharray: 8,4; animation: dash-flow 2s linear infinite`)
- **Glow effect:** `filter: drop-shadow(0 0 6px rgba(220, 74, 26, 0.3))` on
  active nodes
- **Pulsing nodes:** Scale `1.0 > 1.06` over `3s ease-in-out infinite` for
  "live" nodes
- **Network density:** Show clusters of 8-15 nodes; not too sparse, not too
  crowded
- **Responsive:** SVG-based with viewBox. On mobile, simplify to fewer nodes.

#### Economic Flow Diagrams

Token flow diagrams are central to Firecat's story. They show value moving
through the network.

- **Flow direction:** Left-to-right (or top-to-bottom on mobile)
- **Flow lines:** Animated gradient strokes (amber to flame) that show
  directionality
- **Token symbols:** Small circle with `F` (for FCAT) or a flame icon, rendered
  at `16-20px`
- **Value labels:** Badge-style (`12px`, uppercase, `0.06em` tracking,
  background pill)
- **Stages/pools:** Rounded rectangles with semi-transparent fills and `2px`
  borders
- **Percentage labels:** Large display numbers
  (`Space Grotesk, 300 weight, 48-64px`) to make economic data scannable

#### Community-Centric Imagery Metaphors

Firecat does not use stock photography. Visual storytelling is abstract and
geometric.

- **Constellation pattern:** A background pattern of dots and thin connecting
  lines, subtly animated, representing the community network. Used as section
  backgrounds at very low opacity (`0.04-0.08`).
- **Heat map gradients:** Subtle radial gradients in section backgrounds
  suggesting warmth and activity (amber center fading to transparent).
- **Particle effects (hero only):** Lightweight canvas/SVG particle system
  showing ember-like dots drifting upward. Maximum 50 particles. Respects
  `prefers-reduced-motion`.

#### Card Designs

- **Border:** `1px solid #e8e0d8` (resting), `1px solid #dc4a1a` (hover)
- **Border radius:** `12px` (slightly more rounded than B3nd for friendliness)
- **Background:** `#fffbf5` on sand sections, `#ffffff` is not used (always
  warm)
- **Padding:** `32px 24px`
- **Hover behavior:** `translateY(-6px)` +
  `box-shadow: 0 12px 32px rgba(220, 74, 26, 0.12)`
- **Transition:** `all 0.25s cubic-bezier(0.4, 0, 0.2, 1)` (slightly bouncier
  than B3nd)
- **Feature cards:** Optional top accent bar (`4px` height, flame gradient from
  `#dc4a1a` to `#d97706`)
- **Stat cards:** Centered layout with large number (Space Grotesk 300, `48px`)
  above label

#### Animation Philosophy: Dynamic, Conveying Life

Firecat's animations communicate that the network is alive. More motion than
B3nd, but still purposeful.

- **Allowed animations:**
  - All B3nd-permitted animations, plus:
  - Network node pulse (`3s ease-in-out infinite`)
  - Flow line dash animation (`2s linear infinite`)
  - Counter/number count-up on scroll for stats (`1.2s ease-out`, triggered
    once)
  - Staggered card entrance (each card delays `0.08s` after the previous)
  - Hero particle drift (continuous, very subtle)
  - Gradient shift on dark sections (`8s ease infinite`, very subtle hue
    rotation)
  - Hover glow expansion on interactive elements
- **Forbidden animations:**
  - 3D transforms or perspective effects
  - Loading spinners visible for more than `200ms`
  - Any animation that blocks interaction
  - Sound or haptic triggers
- **Performance:** All animations must use `transform` and `opacity` only
  (compositor-friendly). No layout-triggering animations.
- **Reduced motion:** Full respect for `prefers-reduced-motion: reduce`. Replace
  all continuous animations with static states. Keep single-fire transitions but
  remove delays.

#### Icon Style

- **Style:** Rounded line icons, `2px` stroke, `20-24px` size, slightly
  friendlier than B3nd
- **Source:** Phosphor Icons (rounded set) or custom SVGs matching that geometry
- **Color:** Context-driven. Flame color for primary actions, warm gray for
  passive.
- **Special icons:** Flame/fire motif for brand moments (logo, loading state,
  empty states)
- **Node operator icons:** Distinctive set using server/hardware metaphors
- **No filled icons in navigation or body.** Filled icons reserved for badges
  and status indicators.

---

## 3. Component Specifications

### 3.1 B3nd Components

#### Navigation Bar

```
Height: 56px
Background: rgba(255, 255, 255, 0.95)
Backdrop filter: blur(10px)
Border bottom: 1px solid #cbd5e1
Position: fixed, top: 0
Z-index: 100

Logo: "b3nd." -- Inter 700, 22px, color #1a1747, period in #f97316
Links: Inter 500, 14px, color #334155, hover color #4f46e5
CTA button: Inter 600, 14px, bg #4f46e5, color white, padding 6px 16px, radius 6px
CTA hover: bg #1a1747

Mobile (< 768px): Hide nav links, show single CTA button
```

#### Hero Section

```
Layout: Centered, single-column
Min-height: 50vh (not full viewport -- B3nd is efficient, not dramatic)
Background: linear-gradient(135deg, #1a1747 0%, #2a2668 60%, #171440 100%)
Top accent line: 3px solid #f97316 (full width)
Padding: 100px 24px 60px

H1: Display size, white, -0.03em tracking
Tagline: clamp(16px, 2.5vw, 22px), rgba(255,255,255,0.5), lowercase, 0.15em tracking
Subtitle: clamp(14px, 2vw, 17px), rgba(255,255,255,0.7), max-width 480px

No image, no illustration, no particles. Just typography and color.
```

#### Section Card

```
Background: #ffffff
Border: 2px solid #e5e7eb
Border-radius: 10px
Padding: 28px 20px
Text-align: center

Title: Inter 600, 18px, color #0f172a
Description: Inter 400, 13px, color #64748b
Link text: JetBrains Mono 400, 12px, color #4f46e5

Hover: border-color #4f46e5, translateY(-4px), shadow 0 8px 24px rgba(79,70,229,0.10)
Transition: all 0.2s ease
```

#### Code Block

```
Container: bg #0c0b18, radius 10px, overflow hidden
Terminal bar: bg rgba(255,255,255,0.06), padding 10px 16px
  - Dots: 10px circles, colors #ef4444 / #f59e0b / #10b981, gap 6px
  - Label: JetBrains Mono 400, 12px, rgba(255,255,255,0.4)
Code body: padding 20px
  - Font: JetBrains Mono 400, 13px, line-height 1.7
  - Overflow-x: auto
  - Color tokens: see Code Block Palette in section 1.1
```

#### CTA Button Styles

**Primary:**

```
Background: #4f46e5
Color: #ffffff
Font: Inter 600, 14px
Padding: 10px 20px
Border-radius: 8px
Hover: background #1a1747
Transition: all 0.2s ease
```

**Secondary:**

```
Background: transparent
Color: #4f46e5
Font: Inter 600, 14px
Padding: 10px 20px
Border: 2px solid #4f46e5
Border-radius: 8px
Hover: background #4f46e5, color #ffffff
```

**Ghost:**

```
Background: transparent
Color: #64748b
Font: Inter 500, 14px
Padding: 10px 20px
Border-radius: 8px
Hover: background #f1f5f9, color #334155
```

#### Footer

```
Background: #1a1747
Padding: 48px 0 32px

Grid: 3 columns (2fr 1fr 1fr), gap 48px
Brand: logo (white) + tagline (14px, rgba(255,255,255,0.6))
Link columns: h4 (white, 14px, 600) + list (14px, rgba(255,255,255,0.6))
Link hover: color #f97316

Bottom bar: border-top 1px solid rgba(255,255,255,0.1), padding-top 20px
  - Font: 13px, rgba(255,255,255,0.6)
  - Accent links: color #f97316
```

#### Mobile Breakpoint Strategy

```
> 1280px: Full desktop. 1100px container, 4-column card grids.
1024px - 1279px: Condensed desktop. Ownership grid stacks to 1 column.
  Card grids: 2 columns.
768px - 1023px: Tablet. Navigation links hidden, mobile CTA shown.
  Ops row: 2 columns. Privacy levels: 1 column.
< 768px: Mobile. All grids: 1 column. Footer stacks fully.
  Footer bottom: centered, stacked.
  Hero padding reduces. Code panels: full-width with horizontal scroll.
```

---

### 3.2 Firecat Components

#### Navigation Bar

```
Height: 64px (taller than B3nd -- more presence)
Background: rgba(255, 251, 245, 0.92)
Backdrop filter: blur(12px)
Border bottom: 1px solid #e8e0d8
Position: fixed, top: 0
Z-index: 100

Logo: Firecat flame icon (24px) + "firecat" -- Space Grotesk 700, 20px, color #dc4a1a
Links: DM Sans 500, 15px, color #4a4139, hover color #dc4a1a
CTA button: Space Grotesk 600, 14px, bg #dc4a1a, color white, padding 8px 20px, radius 24px (pill shape)
CTA hover: bg #b53a12, shadow 0 4px 12px rgba(220,74,26,0.25)

Mobile (< 768px): Hamburger menu (3-line icon, 2px strokes, warm gray).
  Slide-out panel from right, full-height, sand background.
```

#### Hero Section

```
Layout: Split -- 60% text (left-aligned) / 40% visual (network animation)
Height: 100vh minimum on desktop, auto on mobile
Background: #fffbf5 with subtle radial gradient (amber center, fading to transparent)
Padding: 120px 48px 96px

H1: Display size, Space Grotesk 700, color #1c1610, -0.03em tracking
  Accent word/phrase: color #dc4a1a
Subtitle: DM Sans 400, 20px, color #8a7e72, max-width 520px, margin-top 24px

Primary CTA: Pill button, bg #dc4a1a, color white, 16px, padding 14px 32px
Secondary CTA: Ghost button, color #dc4a1a, border 2px solid #dc4a1a, same sizing
CTA row: flex, gap 16px, margin-top 32px

Right visual: Animated network node cluster (SVG + CSS animation).
  8-12 nodes pulsing gently, connection lines flowing.

Mobile: Stack vertically, text first, then smaller network visual below.
  CTAs stack vertically, full width.
```

#### Section Card

```
Background: #fffbf5
Border: 1px solid #e8e0d8
Border-radius: 12px
Padding: 32px 24px

Optional top bar: 4px height, gradient #dc4a1a to #d97706
Title: Space Grotesk 600, 20px, color #1c1610
Description: DM Sans 400, 15px, color #8a7e72, margin-top 8px

Hover: border-color #dc4a1a, translateY(-6px),
  shadow 0 12px 32px rgba(220,74,26,0.12)
Transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1)
```

**Stat Card (variant):**

```
Text-align: center
Stat number: Space Grotesk 300, 48px, color #dc4a1a
Stat label: DM Sans 500, 14px, color #8a7e72, uppercase, tracking 0.06em
```

**Tokenomics Card (variant):**

```
Background: #fef3e2
Border: 1px solid #d97706
Left accent: 4px solid #d97706

Token amount: Space Grotesk 700, 24px, color #451a03
Token label: DM Sans 400, 14px, color #8a7e72
Flow indicator: Small arrow icon + percentage badge
```

#### Code Block

```
Container: bg #1a1008, radius 12px, overflow hidden
Terminal bar: bg #261c10, padding 12px 16px
  - Dots: 10px circles, colors #ef4444 / #fbbf24 / #22c55e (warmer yellow than B3nd)
  - Label: JetBrains Mono 400, 12px, rgba(255,245,230,0.4)
Code body: padding 24px
  - Font: JetBrains Mono 400, 13px, line-height 1.7
  - Color tokens: see Firecat Code Block Palette in section 2.1
```

#### CTA Button Styles

**Primary:**

```
Background: #dc4a1a
Color: #ffffff
Font: Space Grotesk 600, 15px
Padding: 12px 28px
Border-radius: 24px (pill)
Hover: background #b53a12, shadow 0 4px 16px rgba(220,74,26,0.25)
Transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1)
```

**Secondary:**

```
Background: transparent
Color: #dc4a1a
Font: Space Grotesk 600, 15px
Padding: 12px 28px
Border: 2px solid #dc4a1a
Border-radius: 24px (pill)
Hover: background #dc4a1a, color #ffffff
```

**Ghost:**

```
Background: transparent
Color: #8a7e72
Font: DM Sans 500, 15px
Padding: 12px 28px
Border-radius: 24px (pill)
Hover: background #fef3e2, color #4a4139
```

**Token Action (special variant):**

```
Background: linear-gradient(135deg, #dc4a1a, #d97706)
Color: #ffffff
Font: Space Grotesk 700, 15px
Padding: 14px 32px
Border-radius: 24px (pill)
Hover: shadow 0 6px 24px rgba(220,74,26,0.30), translateY(-1px)
Icon: Small flame or arrow, 16px, left of text
```

#### Footer

```
Background: #451a03
Padding: 64px 0 40px

Grid: 4 columns (2fr 1fr 1fr 1fr), gap 40px
Brand: Flame icon + "firecat" (Space Grotesk 700, white) + tagline (14px, rgba(255,245,230,0.5))
Link columns: h4 (Space Grotesk 600, 13px, rgba(255,245,230,0.8), uppercase, tracking 0.06em)
  + list (DM Sans 400, 14px, rgba(255,245,230,0.5))
Link hover: color #fbbf24

Community section: Social icons row (Discord, Twitter/X, GitHub), 24px, rgba(255,245,230,0.5), hover #fbbf24

Bottom bar: border-top 1px solid rgba(255,245,230,0.1), padding-top 24px
  - Left: copyright, DM Sans 13px, rgba(255,245,230,0.4)
  - Right: "Built on B3nd" with subtle B3nd logo (muted, small), linking to b3nd site
```

#### Mobile Breakpoint Strategy

```
> 1440px: Full desktop. 1280px container, hero split layout, 3-4 column grids.
1024px - 1439px: Condensed desktop. Hero still split but 50/50.
  Card grids: 2-3 columns. Tokenomics flow: horizontal scroll.
768px - 1023px: Tablet. Hamburger menu. Hero stacks (text above visual).
  Card grids: 2 columns. Stats: 2x2 grid.
< 768px: Mobile. Single column throughout.
  Hero: full-width text, small network visual below.
  CTAs: full width, stacked. Card grids: 1 column.
  Tokenomics flow: vertical, simplified.
  Navigation: slide-out panel.
  Footer: single column stack.
```

---

## 4. Contrast Report

A side-by-side comparison demonstrating that these two entities are visually
independent.

### Summary Table

| Element               | B3nd                          | Firecat                              |
| --------------------- | ----------------------------- | ------------------------------------ |
| **Primary Color**     | Deep Indigo `#1a1747`         | Flame `#dc4a1a`                      |
| **Secondary Color**   | Indigo `#4f46e5`              | Amber `#d97706`                      |
| **Accent Color**      | Orange `#f97316`              | Solar Yellow `#fbbf24`               |
| **Page Background**   | Cool white `#ffffff`          | Warm cream `#fffbf5`                 |
| **Alt Background**    | Cool snow `#f8fafc`           | Warm sand `#fef3e2`                  |
| **Text Color**        | Cool slate `#334155`          | Warm gray `#4a4139`                  |
| **Heading Font**      | Inter (neutral, precise)      | Space Grotesk (geometric, energetic) |
| **Body Font**         | Inter (clean, technical)      | DM Sans (warm, approachable)         |
| **Code Font**         | JetBrains Mono                | JetBrains Mono                       |
| **Button Shape**      | Rounded rectangle (`8px`)     | Pill shape (`24px`)                  |
| **Button Feel**       | Solid, mechanical             | Warm, inviting                       |
| **Card Radius**       | `10px`                        | `12px`                               |
| **Card Border**       | `2px` solid (structural)      | `1px` solid (lighter touch)          |
| **Content Width**     | `1100px` (dense, focused)     | `1280px` (expansive, breathing)      |
| **Nav Height**        | `56px` (compact, utilitarian) | `64px` (spacious, branded)           |
| **Hero Style**        | Centered, text-only, 50vh     | Split layout, with visual, 100vh     |
| **Section Padding**   | `80px`                        | `96px`                               |
| **Grid Gutters**      | `20px`                        | `24px`                               |
| **Color Temperature** | Cool (blue-violet dominant)   | Warm (amber-red dominant)            |
| **Footer Bg**         | Deep indigo `#1a1747`         | Deep ember `#451a03`                 |
| **Code Block Bg**     | Cool dark `#0c0b18`           | Warm dark `#1a1008`                  |

### Typography Contrast

| Attribute           | B3nd                       | Firecat                                |
| ------------------- | -------------------------- | -------------------------------------- |
| Heading typeface    | Inter (grotesque, Swiss)   | Space Grotesk (geometric, distinctive) |
| Body typeface       | Inter                      | DM Sans                                |
| Display weight      | 700 only                   | 700 + occasional 300 for stats         |
| Minimum weight used | 400                        | 300                                    |
| Tracking feel       | Tighter (-0.02em headings) | Similar tightness but more open body   |
| Case treatment      | Lowercase taglines         | Uppercase badges/labels                |
| Personality         | "Technical documentation"  | "Modern product marketing"             |

### Layout Contrast

| Attribute         | B3nd                      | Firecat                                     |
| ----------------- | ------------------------- | ------------------------------------------- |
| Overall alignment | Centered, symmetric       | Asymmetric, left-anchored heroes            |
| Hero composition  | Single centered column    | 60/40 split with visual element             |
| Grid behavior     | Uniform, even columns     | Mixed: some uniform, some offset            |
| Visual density    | Dense, information-rich   | Spacious, scan-friendly                     |
| Dark sections     | Hero and footer only      | Hero, footer, and mid-page punctuation      |
| Scroll rhythm     | Steady alternation        | Varied with dramatic dark breaks            |
| Content hierarchy | Flat (sections are peers) | Peaked (hero is dominant, sections cascade) |

### Animation Contrast

| Attribute              | B3nd                     | Firecat                                   |
| ---------------------- | ------------------------ | ----------------------------------------- |
| Philosophy             | "Only when necessary"    | "Alive but not distracting"               |
| Hover transitions      | `0.2s ease`              | `0.25s cubic-bezier(0.4, 0, 0.2, 1)`      |
| Scroll animations      | Simple fade-in           | Staggered card entrances                  |
| Continuous animation   | None (or minimal pulse)  | Network node pulse, flow lines, particles |
| Hero animation         | None                     | Particle drift + node network             |
| Easing character       | Linear/ease (mechanical) | Cubic-bezier (organic, springy)           |
| Max animation duration | `0.6s` (user-triggered)  | `3s` (ambient continuous)                 |

### Mood Contrast

| Attribute                | B3nd                               | Firecat                           |
| ------------------------ | ---------------------------------- | --------------------------------- |
| One-word mood            | **Precise**                        | **Alive**                         |
| Visual metaphor          | Blueprint / architectural drawing  | Living network / constellation    |
| Emotional register       | Confidence through restraint       | Energy through warmth             |
| Trust signal             | "We are rigorous"                  | "We are growing"                  |
| Who feels at home        | Protocol engineers, infra builders | App developers, community members |
| Design tradition         | Swiss/International typographic    | Contemporary product/SaaS         |
| If it were a material    | Brushed steel                      | Warm copper                       |
| If it were a time of day | Pre-dawn (clear, still)            | Golden hour (warm, dynamic)       |
| If it were a sound       | A clean terminal beep              | A campfire crackle                |

---

## Appendix: Implementation Notes

### Font Loading

**B3nd:**

```html
<link
  href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
  rel="stylesheet"
>
```

**Firecat:**

```html
<link
  href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=JetBrains+Mono:wght@400;500&display=swap"
  rel="stylesheet"
>
```

### CSS Custom Properties

**B3nd:**

```css
:root {
  --b3nd-primary: #1a1747;
  --b3nd-secondary: #4f46e5;
  --b3nd-accent: #f97316;
  --b3nd-success: #10b981;
  --b3nd-bg: #ffffff;
  --b3nd-bg-alt: #f8fafc;
  --b3nd-bg-subtle: #f1f5f9;
  --b3nd-border: #cbd5e1;
  --b3nd-text: #334155;
  --b3nd-text-heading: #0f172a;
  --b3nd-text-muted: #64748b;
  --b3nd-code-bg: #0c0b18;
  --b3nd-code-surface: #161428;
}
```

**Firecat:**

```css
:root {
  --fc-primary: #dc4a1a;
  --fc-secondary: #d97706;
  --fc-deep: #7c1d1d;
  --fc-darkest: #451a03;
  --fc-solar: #fbbf24;
  --fc-bg: #fffbf5;
  --fc-bg-alt: #fef3e2;
  --fc-border: #e8e0d8;
  --fc-text: #4a4139;
  --fc-text-heading: #1c1610;
  --fc-text-muted: #8a7e72;
  --fc-node-green: #22c55e;
  --fc-reward-gold: #eab308;
  --fc-code-bg: #1a1008;
  --fc-code-surface: #261c10;
}
```

### Design Token Naming Convention

Both sites should use a consistent naming pattern for design tokens, but with
their own prefix to prevent any confusion during development:

- B3nd: `--b3nd-{category}-{variant}` (e.g., `--b3nd-text-muted`)
- Firecat: `--fc-{category}-{variant}` (e.g., `--fc-text-muted`)

This ensures that even if both sites share a codebase or monorepo, their tokens
never collide.

---

_This document is a design direction guide, not a component library.
Implementation should translate these specifications into the chosen framework
(HTML/CSS, React, Astro, etc.) while preserving the distinct visual identities
described above._
