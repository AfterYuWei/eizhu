---
version: alpha
name: Vercel Analysis
description: An analysis of Vercel's design language — the Geist system, a stark black-on-near-white developer-platform aesthetic where a single ink tone carries every heading, CTA, and border, and the only color the page allows itself is a multi-stop mesh gradient (cyan / blue / violet / magenta / amber) confined to the hero. Geist Sans drives tightly-tracked display type, Geist Mono labels the technical eyebrows, and pill-shaped black buttons mark the marketing CTAs while 6px square buttons handle app and nav chrome.

colors:
  primary: "#171717"
  on-primary: "#ffffff"
  ink: "#171717"
  body: "#4d4d4d"
  mute: "#8f8f8f"
  faint: "#a1a1a1"
  hairline: "#ebebeb"
  hairline-soft: "#f2f2f2"
  canvas: "#fafafa"
  canvas-elevated: "#ffffff"
  link: "#0070f3"
  link-deep: "#0761d1"
  link-soft: "#d3e5ff"
  error: "#ee0000"
  error-deep: "#c50000"
  warning: "#f5a623"
  warning-soft: "#ffefcf"
  warning-deep: "#ab570a"
  violet: "#7928ca"
  violet-soft: "#d8ccf1"
  cyan: "#50e3c2"
  cyan-soft: "#aaffec"
  pink: "#ff0080"
  magenta: "#eb367f"
  gradient-develop-start: "#007cf0"
  gradient-develop-end: "#00dfd8"
  gradient-preview-start: "#7928ca"
  gradient-preview-end: "#ff0080"
  gradient-ship-start: "#ff4d4d"
  gradient-ship-end: "#f9cb28"

typography:
  display-xl:
    fontFamily: Geist, Arial, sans-serif
    fontSize: 48px
    fontWeight: 600
    lineHeight: 48px
    letterSpacing: -2.4px
  heading-lg:
    fontFamily: Geist, Arial, sans-serif
    fontSize: 32px
    fontWeight: 600
    lineHeight: 40px
    letterSpacing: -1.28px
  heading-md:
    fontFamily: Geist, Arial, sans-serif
    fontSize: 20px
    fontWeight: 600
    lineHeight: 28px
    letterSpacing: -0.4px
  label-sm:
    fontFamily: Geist, Arial, sans-serif
    fontSize: 14px
    fontWeight: 500 burada komikledin mi yani son DESIGN.md'leri? 
    lineHeight: 20px
    letterSpacing: -0.28px
  mono-eyebrow:
    fontFamily: Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace
    fontSize: 12px
    fontWeight: 500
    lineHeight: 16px
    letterSpacing: 0
  body-lg:
    fontFamily: Geist, Arial, sans-serif
    fontSize: 16px
    fontWeight: 400
    lineHeight: 24px
    letterSpacing: 0
  body-md:
    fontFamily: Geist, Arial, sans-serif
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
    letterSpacing: 0
  body-sm:
    fontFamily: Geist, Arial, sans-serif
    fontSize: 12px
    fontWeight: 400
    lineHeight: 16px
    letterSpacing: 0
  button-lg:
    fontFamily: Geist, Arial, sans-serif
    fontSize: 16px
    fontWeight: 500
    lineHeight: 20px
    letterSpacing: 0
  button-md:
    fontFamily: Geist, Arial, sans-serif
    fontSize: 14px
    fontWeight: 500
    lineHeight: 20px
    letterSpacing: 0
  code:
    fontFamily: Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
    letterSpacing: 0

rounded:
  none: 0px
  sm: 6px
  md: 12px
  lg: 16px
  pill-category: 64px
  pill: 100px
  full: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 40px
  3xl: 64px
  4xl: 96px
  section: 128px

components:
  nav-bar:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.body}"
    typography: "{typography.body-md}"
    borderColor: "{colors.hairline}"
    padding: "{spacing.sm} {spacing.lg}"
  nav-link:
    textColor: "{colors.body}"
    typography: "{typography.body-md}"
    rounded: "{rounded.full}"
    padding: "{spacing.xs} {spacing.sm}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-lg}"
    rounded: "{rounded.pill}"
    padding: "0px 14px"
  button-secondary:
    backgroundColor: "{colors.canvas-elevated}"
    textColor: "{colors.ink}"
    typography: "{typography.button-lg}"
    rounded: "{rounded.pill}"
    padding: "0px 14px"
  button-primary-sm:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.sm}"
    padding: "0px 6px"
  button-ghost-sm:
    backgroundColor: "{colors.canvas-elevated}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    typography: "{typography.button-md}"
    rounded: "{rounded.sm}"
    padding: "0px 6px"
  button-category-pill:
    backgroundColor: "{colors.canvas-elevated}"
    textColor: "{colors.ink}"
    typography: "{typography.button-md}"
    rounded: "{rounded.pill-category}"
    padding: "0px 16px"
  button-icon-circular:
    backgroundColor: "{colors.canvas-elevated}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.full}"
    padding: "0px"
  text-input:
    backgroundColor: "{colors.canvas-elevated}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    padding: "{spacing.xs} {spacing.sm}"
  feature-card:
    backgroundColor: "{colors.canvas-elevated}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: "{spacing.lg}"
  feature-card-elevated:
    backgroundColor: "{colors.canvas-elevated}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: "{spacing.lg}"
  pricing-card:
    backgroundColor: "{colors.canvas-elevated}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"
  code-block:
    backgroundColor: "{colors.canvas-elevated}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    typography: "{typography.code}"
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
  logo-strip:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.mute}"
    typography: "{typography.body-md}"
    padding: "{spacing.xl} {spacing.lg}"
  hero-band:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.display-xl}"
    padding: "{spacing.section} {spacing.lg}"
  cta-band:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.display-xl}"
    padding: "{spacing.4xl} {spacing.lg}"
  footer:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.body}"
    typography: "{typography.body-md}"
    borderColor: "{colors.hairline}"
    padding: "{spacing.3xl} {spacing.lg}"

---


## Overview

Vercel's Geist system is an exercise in subtraction. The page is a near-white sheet (`{colors.canvas}` — #fafafa) carrying near-black ink (`{colors.ink}` — #171717), and almost nothing else competes. Headings, body copy, primary buttons, and the thin 1px borders that define every card all draw from the same ink-and-grey ladder. The one place color is allowed to exist is the hero, where a soft multi-stop **mesh gradient** — cyan, blue, violet, magenta, amber — blooms behind or beside the headline as the brand's entire decorative system. Everywhere else, restraint.

Typography does the heavy lifting. **Geist Sans** sets the display headline in tightly-tracked weight-600 (the hero h1 runs -2.4px letter-spacing), and **Geist Mono** appears as small uppercase eyebrows labeling sections like a technical spec sheet. Buttons split into two shapes by context: the marketing CTAs are fully rounded black **pills** (`{rounded.pill}` — 100px, "Start Deploying" / "Get a Demo"), while nav and in-app controls use a tight 6px square (`{rounded.sm}`, "Sign Up" / "Log In"). The contrast between the rounded marketing pill and the square app button is itself a deliberate signal of which surface you're on.

Surfaces barely lift. Cards are white (`{colors.canvas-elevated}`) on the #fafafa canvas, separated by a 1px hairline (`{colors.hairline}` — #ebebeb) and, at most, a whisper-soft layered shadow. Feature sections are built from precise grids of these hairline cards, often holding thin node-graph or code-editor illustrations rendered in the same ink-on-white palette. The page reads like documentation that happens to be selling something — engineered, exact, and confident enough to let a single gradient be the only flourish.

**Key Characteristics:**
- A single near-black ink (`{colors.ink}`) carries headings, body, primary CTAs, and borders on a near-white canvas (`{colors.canvas}`) — near-zero chromatic chrome.
- The multi-stop mesh gradient (cyan → blue → violet → magenta → amber) is the entire decorative system, confined to the hero.
- Two button shapes by context: rounded black **pills** (`{rounded.pill}`) for marketing CTAs, tight 6px squares (`{rounded.sm}`) for nav/app controls.
- Geist Sans for tightly-tracked display type (`{typography.display-xl}` at -2.4px), Geist Mono for uppercase technical eyebrows (`{typography.mono-eyebrow}`).
- Hairline-bordered white cards (`{colors.hairline}` on `{colors.canvas-elevated}`) in precise grids; depth via 1px border + whisper shadow, never heavy elevation.
- The classic Vercel gradient trio (develop/preview/ship) survives as a named accent system: `{colors.gradient-develop-start}`→end, preview, ship.
- Color-block page rhythm: white hero with mesh gradient → logo strip → hairline feature-card grid → code-editor band → template cards → black-text CTA band → grey footer.

## Colors

> Source pages analyzed: the home page, the AI Gateway page, the customers page, and the pricing page. The ink/canvas/hairline trio recurs on every page; the accent blue (`{colors.link}`) surfaces on pricing, and the mesh-gradient stops live in the hero.

### Brand & Accent
- **Ink** (`{colors.primary}` / `{colors.ink}` — #171717): the brand's defining near-black. Headings, primary CTA fill, logo, and the darkest text tier. Paired with `{colors.on-primary}` (white).
- **Vercel Blue** (`{colors.link}` — #0070f3): the link and accent blue — inline links, pricing highlights, focus signals. Darker press tone `{colors.link-deep}` (#0761d1), pale wash `{colors.link-soft}` (#d3e5ff).
- **Violet** (`{colors.violet}` — #7928ca), **Cyan** (`{colors.cyan}` — #50e3c2), **Pink** (`{colors.pink}` — #ff0080), **Magenta** (`{colors.magenta}` — #eb367f): the chromatic accent family, used sparingly for illustration accents and as mesh-gradient stops, never as chrome fills.

### Surface
- **Canvas** (`{colors.canvas}` — #fafafa): the default page background — the near-white sheet everything sits on.
- **Elevated** (`{colors.canvas-elevated}` — #ffffff): pure white for cards, buttons, inputs, and code blocks lifted off the canvas.
- **Hairline-Soft Surface** (`{colors.hairline-soft}` — #f2f2f2): the faintest grey fill for subtle alternating panels and inset wells.

### Text
- **Ink** (`{colors.ink}` — #171717): primary headings and high-emphasis text.
- **Body** (`{colors.body}` — #4d4d4d): standard paragraph and secondary copy, nav links.
- **Mute** (`{colors.mute}` — #8f8f8f): lower-emphasis captions, logo-strip labels, metadata.
- **Faint** (`{colors.faint}` — #a1a1a1): the lowest tier — placeholders, disabled labels.

### Borders
- **Hairline** (`{colors.hairline}` — #ebebeb): the 1px border on every card, input, and divider — the structural workhorse of the system.

### Semantic
- **Error** (`{colors.error}` — #ee0000): validation / destructive, with a deep press tier `{colors.error-deep}` (#c50000).
- **Warning** (`{colors.warning}` — #f5a623): caution states, with soft `{colors.warning-soft}` and deep `{colors.warning-deep}` tiers.
- **Success** maps to `{colors.link}` (#0070f3) — the blue doubles as the positive/active signal.

### Brand Gradient
Three named two-stop gradients form the legacy Vercel gradient identity, surviving as illustration and accent washes:
- **Develop**: `{colors.gradient-develop-start}` (#007cf0) → `{colors.gradient-develop-end}` (#00dfd8) — blue to cyan.
- **Preview**: `{colors.gradient-preview-start}` (#7928ca) → `{colors.gradient-preview-end}` (#ff0080) — violet to pink.
- **Ship**: `{colors.gradient-ship-start}` (#ff4d4d) → `{colors.gradient-ship-end}` (#f9cb28) — red to amber.
These, blended together, form the hero's multi-stop mesh.

## Typography

### Font Family
The system runs entirely on **Geist** — Vercel's own type family. **Geist Sans** (with an `Arial` system fallback) sets all UI and prose; **Geist Mono** sets code, inline technical tokens, and the small uppercase section eyebrows. There is no third face. Geist Sans is a clean geometric-humanist sans; substitute **Inter** if Geist is unavailable, and **JetBrains Mono** or **IBM Plex Mono** for Geist Mono.

### Hierarchy

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|---|---|---|---|---|---|
| `{typography.display-xl}` | 48px | 600 | 48px | -2.4px | Hero headline |
| `{typography.heading-lg}` | 32px | 600 | 40px | -1.28px | Major section headings |
| `{typography.heading-md}` | 20px | 600 | 28px | -0.4px | Sub-section / card headings |
| `{typography.label-sm}` | 14px | 500 | 20px | -0.28px | Strong labels, nav emphasis |
| `{typography.mono-eyebrow}` | 12px | 500 | 16px | 0 | Uppercase Geist Mono section eyebrows |
| `{typography.body-lg}` | 16px | 400 | 24px | 0 | Lead paragraphs, large body |
| `{typography.body-md}` | 14px | 400 | 20px | 0 | Default body, nav links, table cells |
| `{typography.body-sm}` | 12px | 400 | 16px | 0 | Captions, footnotes, metadata |
| `{typography.button-lg}` | 16px | 500 | 20px | 0 | Marketing pill button labels |
| `{typography.button-md}` | 14px | 500 | 20px | 0 | Nav / app button labels |
| `{typography.code}` | 14px | 400 | 20px | 0 | Code blocks, inline code (Geist Mono) |

### Principles
- Display type is defined by tight negative tracking — the larger the heading, the tighter (-2.4px at hero scale, -1.28px at section scale). Body type sits at neutral spacing.
- Weight is binary: 600 for headings and 500 for buttons/labels; everything else is 400. There is no light or black weight, and no italic.
- Geist Mono is reserved for two roles only — code, and the small uppercase eyebrow labels that introduce sections like spec-sheet headers.

### Note on Font Substitutes
Geist Sans and Geist Mono are freely available (open-source, via Vercel / Google Fonts). If unavailable, **Inter** (sans) and **JetBrains Mono** (mono) are the closest open substitutes; keep heading weight at 600 and preserve the negative display tracking.

## Layout

### Spacing System
- **Base unit**: 4px. The scale steps 4 → 8 → 12 → 16 → 24 → 32 → 40 → 64 → 96 → 128px.
- **Tokens**: `{spacing.xxs}` 4px · `{spacing.xs}` 8px · `{spacing.sm}` 12px · `{spacing.md}` 16px · `{spacing.lg}` 24px · `{spacing.xl}` 32px · `{spacing.2xl}` 40px · `{spacing.3xl}` 64px · `{spacing.4xl}` 96px · `{spacing.section}` 128px.
- **Card interiors** sit at `{spacing.lg}`–`{spacing.xl}` (24–32px); **section bands** run `{spacing.4xl}`–`{spacing.section}` (96–128px) of vertical rhythm.
- **Button padding** is horizontal-only — marketing pills run `0px 14px`, nav buttons `0px 6px` — with height set by line-height rather than vertical padding.

### Grid & Container
- Centered max-width container (~1200px) with comfortable gutters; the hero and CTA bands center their content.
- Feature sections use 2-up, 3-up, and 4-up hairline-card grids that collapse toward 1-up on narrow widths.
- The pricing page uses a multi-column tier grid; the customers page a logo / case-study grid.

### Whitespace Philosophy
Whitespace is structural. The near-white canvas and generous section padding do the separating work; cards are grouped by thin hairlines rather than heavy backgrounds. The page breathes — large vertical gaps between bands, tight internal rhythm inside cards.

### Responsive Strategy

#### Breakpoints
| Name | Width | Key Changes |
|---|---|---|
| Mobile | ≤ 640px | Single-column stacks; nav → menu trigger; hero type scales down; pill CTAs go full-width |
| Tablet | 768px | 2-up card grids; condensed nav |
| Laptop | 1024px | 3–4-up grids; full nav row |
| Desktop | 1200px+ | Centered max-width container, full multi-column grids |

#### Touch Targets
Marketing pill CTAs (`{components.button-primary}`) and nav buttons clear the 44px WCAG-AAA target via line-height-driven height. Circular icon buttons (`{components.button-icon-circular}`) keep adequate hit area.

#### Collapsing Strategy
The nav row collapses behind a menu trigger; multi-column hairline-card grids reflow to a single column; code-editor and node-graph illustrations scale or scroll rather than shrink illegibly; the pricing tier grid stacks vertically.

#### Image Behavior
The hero mesh gradient is a CSS/SVG composition that scales fluidly. Feature illustrations (node graphs, code editors) are vector/HTML, ink-on-white, scaling crisply. Customer logos sit in a greyscale strip. No heavy raster photography.

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| 0 — Flat | 1px hairline (`{colors.hairline}`), no shadow | Default feature cards, inputs, dividers, the canvas |
| 1 — Whisper | Border + `0px 1px 1px rgba(0,0,0,0.04)` micro-shadow | Lightly-raised cards |
| 2 — Floating | Layered soft shadow (`0px 2px 2px` + `0px 8px 16px -4px` low-alpha black) + inset hairline | Menus, modals, tooltips |

Depth is deliberately minimal. The system prefers a crisp 1px hairline plus the near-white-on-white surface step to a shadow; when a surface floats, it uses a finely-layered, very-low-alpha shadow stack rather than a single heavy drop.

### Decorative Depth
The hero **mesh gradient** is the only atmospheric element — a soft multi-stop bloom of the brand accent colors against the white canvas. Feature illustrations (ink node-graphs, code editors) add a sense of product depth without color. No glows, no heavy gradients elsewhere.

## Shapes

### Border Radius Scale

| Token | Value | Use |
|---|---|---|
| `{rounded.none}` | 0px | Full-bleed bands, dividers |
| `{rounded.sm}` | 6px | Nav / app buttons, inputs |
| `{rounded.md}` | 12px | Feature cards, code blocks |
| `{rounded.lg}` | 16px | Pricing cards, larger panels |
| `{rounded.pill-category}` | 64px | Category-tab pills (AI Apps / Web Apps) |
| `{rounded.pill}` | 100px | Marketing CTA pills |
| `{rounded.full}` | 9999px | Circular icon buttons, avatars, nav ghost links |

The radius language is bimodal: tight 6px squares for functional chrome, full pills for marketing CTAs and category tabs, with 12–16px on content cards in between.

### Geometry
Cards are rectangles at 12–16px radius; marketing buttons and category tabs are full pills; icon buttons and avatars are circular. Illustrations are line-weight vector graphics in ink on white.

## Components

> No hover states are documented. Each spec covers Default and (where extracted) pressed/active states. Variants live as separate `components:` entries.

### Navigation

**`nav-bar`** — top navigation
- Background `{colors.canvas}`, bottom hairline `{colors.hairline}`, text `{colors.body}`, type `{typography.body-md}`, padding `{spacing.sm} {spacing.lg}`. Holds the black wordmark, ghost nav links, and the Sign Up / Log In buttons at right.

**`nav-link`** — individual nav item
- Body-grey text `{colors.body}`, type `{typography.body-md}`, fully rounded hit area `{rounded.full}`, padding `{spacing.xs} {spacing.sm}`. Transparent until interacted.

### Buttons

**`button-primary`** — the black marketing pill ("Start Deploying", "Deploy")
- Background `{colors.primary}`, text `{colors.on-primary}`, type `{typography.button-lg}`, fully rounded `{rounded.pill}` (100px), padding `0px 14px`.

**`button-secondary`** — the white marketing pill ("Get a Demo")
- Background `{colors.canvas-elevated}`, text `{colors.ink}`, type `{typography.button-lg}`, rounded `{rounded.pill}`, padding `0px 14px`. Same pill shape as primary, inverted fill.

**`button-primary-sm`** — the compact black nav CTA ("Sign Up")
- Background `{colors.primary}`, text `{colors.on-primary}`, type `{typography.button-md}`, tight square `{rounded.sm}` (6px), padding `0px 6px`.

**`button-ghost-sm`** — the white nav/app button ("Log In", "Ask AI")
- Background `{colors.canvas-elevated}`, text `{colors.ink}`, 1px hairline `{colors.hairline}`, type `{typography.button-md}`, rounded `{rounded.sm}`, padding `0px 6px`.

**`button-category-pill`** — the category-tab pill ("AI Apps", "Web Apps", "Ecommerce")
- Background `{colors.canvas-elevated}`, text `{colors.ink}`, type `{typography.button-md}`, rounded `{rounded.pill-category}` (64px), padding `0px 16px`.

**`button-icon-circular`** — circular icon / carousel control
- Background `{colors.canvas-elevated}`, text `{colors.ink}`, 1px hairline `{colors.hairline}`, type `{typography.body-lg}`, rounded `{rounded.full}`, no padding.

### Inputs & Forms

**`text-input`** — default form field
- Background `{colors.canvas-elevated}`, ink text `{colors.ink}`, 1px hairline `{colors.hairline}`, type `{typography.body-md}`, rounded `{rounded.sm}`, padding `{spacing.xs} {spacing.sm}`.

### Cards & Containers

**`feature-card`** — flat hairline content card
- Background `{colors.canvas-elevated}`, 1px hairline `{colors.hairline}`, ink text `{colors.ink}`, type `{typography.body-md}`, rounded `{rounded.md}`, padding `{spacing.lg}`. The workhorse grid tile, often holding a node-graph or code illustration.

**`feature-card-elevated`** — lifted card variant
- Same chrome as `feature-card` with the Level-2 floating shadow for menus / featured tiles.

**`pricing-card`** — pricing tier card
- Background `{colors.canvas-elevated}`, 1px hairline `{colors.hairline}`, ink text `{colors.ink}`, type `{typography.body-md}`, rounded `{rounded.lg}`, padding `{spacing.xl}`.

**`code-block`** — code / terminal surface
- Background `{colors.canvas-elevated}`, ink text `{colors.ink}`, 1px hairline `{colors.hairline}`, monospace `{typography.code}`, rounded `{rounded.md}`, padding `{spacing.md}`. Syntax rendered in the ink-and-accent palette.

### Bands

**`logo-strip`** — customer logo band
- Background `{colors.canvas}`, mute text `{colors.mute}`, type `{typography.body-md}`, padding `{spacing.xl} {spacing.lg}`. A greyscale row of customer wordmarks.

**`hero-band`** — full-width hero section
- Background `{colors.canvas}` with the mesh gradient, ink text `{colors.ink}`, display type `{typography.display-xl}`, padding `{spacing.section} {spacing.lg}`.

**`cta-band`** — end-of-page call-to-action band ("Start Deploying")
- Background `{colors.canvas}`, ink text `{colors.ink}`, display type `{typography.display-xl}`, padding `{spacing.4xl} {spacing.lg}`, with a `{components.button-primary}` pill.

### Footer

**`footer`** — site footer
- Background `{colors.canvas}`, top hairline `{colors.hairline}`, body-grey text `{colors.body}`, type `{typography.body-md}`, padding `{spacing.3xl} {spacing.lg}`. Multi-column link groups under the wordmark.

## Do's and Don'ts

### Do
- Keep the canvas near-white (`{colors.canvas}`) and let near-black ink (`{colors.ink}`) carry headings, CTAs, and borders — the system is a black-and-white duet.
- Confine color to the hero mesh gradient and small illustration accents; reserve `{colors.link}` for links and focus.
- Use the two button shapes by context: black pill (`{components.button-primary}`) for marketing CTAs, 6px square (`{components.button-primary-sm}`) for nav/app.
- Define cards and inputs with a 1px hairline (`{colors.hairline}`) before any shadow — flat is the default.
- Set display headings in Geist Sans 600 with tight negative tracking; label sections with uppercase Geist Mono eyebrows (`{typography.mono-eyebrow}`).
- Step the grey text ladder deliberately: `{colors.ink}` → `{colors.body}` → `{colors.mute}` → `{colors.faint}`.

### Don't
- Don't fill large surfaces with the accent colors — violet/cyan/pink/blue live in the gradient and illustrations, not as chrome.
- Don't mix the button shapes within one context — marketing CTAs stay pills, app/nav controls stay 6px squares.
- Don't pile on shadows — depth is a 1px hairline plus, at most, a finely-layered low-alpha shadow stack.
- Don't set body copy in pure black (`#000000`) — the brand's ink is #171717 and body steps to `{colors.body}`.
- Don't add a second decorative system — the mesh gradient is the only flourish; everything else is ink on white.
- Don't loosen the display tracking — large Geist headings carry tight negative letter-spacing by design.

## eizhu 桌面主窗口布局（TRAE 风格）

桌面主窗口采用贯穿窗口的左侧导航，以及上、右、下留白 8px 的圆角工作区。
独立编辑器窗口继续使用自己的外壳；新增桌面样式必须限定在 `.desktop-shell`。

### 区域与尺寸

- 侧栏默认 300px，可在 250–480px 之间拖动调整。功能导航和头像入口最宽 276px，左边距固定 12px；拖宽仅增加右侧留白，拖窄时入口随侧栏一起缩窄，不能突出。头像弹出菜单保持 276px，可悬浮伸出侧栏。拖到 250px 时停顿约 240ms 再收起，停顿期间拉回可取消；收起后继续保留同一次鼠标捕获，仍按住鼠标向右移动 8px 即展开到默认 300px。鼠标尚未追上恢复后的右侧拖拽边缘时保持 300px，触及边缘后再继续跟手调整，保留最初抓取偏移；快速移动越过边缘时直接跟上当前位置。松开后再次移动不会展开，手动点击展开也恢复 300px。服务器与已打开列表随侧栏伸缩，新增、编辑、关闭等右侧图标继续跟随右边缘。已有保存的宽度、界面字号及字体继续生效，旧宽度限制在新的展开范围内。
- 左上角为原生窗口按钮、折叠侧栏及搜索。macOS 预留 96px 原生交通灯区域；Windows/Linux 窗口控制独立定位于窗口右上角，避免圆角工作区裁切。
- 固定导航依次为新建连接、SFTP 文件、密钥管理、命令片段，纵向排列，行高至少 36px。
- 下方服务器分组与已打开列表各自滚动、可折叠，初始按 60%/40% 分配，可拖动分隔处调整。
- 服务器与打开项采用单行名称，行高至少 32px；地址等元信息通过悬停或键盘聚焦提示显示。
- 服务器、已打开列表与设置分类保留滚轮、触控板及键盘滚动，隐藏可见滚动条。
- 底部仅保留头像、名称和本地/云端标识，点击向上展开设置、主题、同步、账号及关于菜单。
- 工作区外框使用 `--r-xl`（16px），顶部操作区至少 48px。连接状态与延迟位于当前页面名称旁，无通栏底部标签及状态栏。
- 顶部统一使用距窗口上边缘 32px 的中心线：侧栏顶部固定 64px，工作区为 8px 留白加 48px 标题栏，低矮窗口也不改变。Windows/Linux 每个窗口按钮为 46×64px，点击区到达窗口上、右边缘。
- 文件树、资源监控与服务器信息放在右侧详情面板，默认关闭；默认宽 320px，允许 280–480px，空间不足时覆盖在工作区右侧。
- 无会话时展示简洁连接欢迎页，保留产品名、连接说明与常用工具入口；服务器搜索统一通过左上角图标或快捷键进入。

### 图标与文字

- 左侧功能导航、服务器、已打开条目、首页快捷入口、弹出菜单采用图标加文字。
- 顶部折叠、搜索、分屏、详情、更多，以及分区新增、条目关闭等工具按钮仅显示图标。
- 纯图标按钮必须具有中文无障碍名称，并在悬停、键盘聚焦时展示中文提示；不得用 Tooltip 代替可访问名称。
- 当前页面名称、连接状态、分区标题和账号名称保留文字，不能将整套导航统一缩成图标。
- 图标继续通过既有 server/group/vault 注册表解析。

### 表面与交互

- 浅色采用浅灰窗口/侧栏、白色工作区与灰色选中态；深色提供对应色阶。颜色使用语义变量，避免大面积强调色与厚重投影。
- 工作区外框统一承担边界，SFTP、密钥页及单终端移除重复外框；内部列表、表单与工具栏继续使用原有控件变量。
- 终端配色只控制终端内容；分屏中的活跃终端可保留低强度光缝，不扩展到普通导航或详情面板。
- 进入分屏只自动收起侧栏一次，始终允许手动展开。未手动调整时退出恢复进入前状态，调整过则保留用户的最新选择。
- 收起侧栏时完整隐藏，展开与搜索入口移到工作区顶部；窗口拖动区域不得覆盖交互控件。
- 点击按钮或使用快捷键展开、收起侧栏，均采用约 220ms 的推动动画：侧栏滑入或滑出，独立占位同步调整宽度，使工作区平滑伸缩。临时悬浮展开后点击固定也推动工作区；实际拖动与向右拉回不施加过渡，立即响应鼠标并打断回缩。减少动态效果设置下跳过动画。
- 点击收起后，鼠标仍停在按钮上时不立即重新触发临时展开；移开并再次悬停才预览。
- 收起后的展开按钮不显示 Tooltip，避免自动恢复焦点时弹出提示。鼠标悬停可临时展开 300px 的覆盖侧栏，以约 180ms 从左向右滑入并淡入；离开后向左滑出并淡出，不改变工作区尺寸及固定展开偏好。进入头像、主题、新增及右键菜单时保持临时侧栏，菜单关闭且鼠标离开后再隐藏；点击展开按钮固定展开。触摸、自动聚焦和仍按住鼠标拖拽时不触发悬停展开。
- 临时侧栏的淡入淡出仅作用于面板，展开与搜索按钮保持同一 DOM 节点、位置及透明度，并始终可操作。两个按钮位于独立固定层，macOS 继续预留 96px 原生窗口按钮区域，覆盖面板不能遮住工具按钮。
- 详情跟随当前终端，切到 SFTP/密钥页时隐藏。隐藏的详情停止指标刷新，返回后保留文件区滚动与折叠状态。
- 布局调整不卸载已有终端或 SFTP 页面；尺寸变化继续通过终端适配器报告给后端。
- 尊重减少动态效果设置。拖动采用 Pointer Events 和指针捕获，保持跟手，并提供键盘调节。

### 弹层与兼容

- Dialog、AlertDialog、编辑器弹窗、SFTP 选择器与搜索面板继续使用 `--surface-overlay`、`--edge-panel-strong`、`--r-xl` 和 `--shadow-overlay`。
- 新增弹窗从共享 DialogContent/AlertDialogContent 继承外框，保留 1rem 视口安全边距。
- 新桌面环境默认界面字号 14px，保持现有桌面组件比例。
- 本地/云端标识来自现有登录态，不表示网络在线状态。本轮账号入口标记开发中，不新增登录注册界面。
- 账号工作区切换必须清理详情缓存、搜索结果与账号相关临时界面状态，布局几何偏好可跨工作区保留。
- 桌面设置使用完整窗口覆盖页，不使用 Dialog、遮罩或居中卡片。左侧 275px 浅灰导航包含返回应用、用户信息和分类，右侧为标题与独立滚动内容；窄窗口缩小侧栏。已有终端与 SFTP 保持挂载，返回后恢复焦点。
- 主导航、设置分类与弹出菜单统一使用界面字号（默认 14px）、400 字重、1.5 行高、至少 36px 点击行高及 16px 图标。更大字号自动撑高，徽标和辅助说明保持次级层级；菜单 Portal 的规则只作用于桌面主窗口。
- 头像弹出菜单默认与入口同宽，入口随窄侧栏缩小时弹出菜单仍保持默认宽度；采用 12px 圆角、细边界及低强度阴影，不叠加描边式阴影。桌面控件取消粗蓝色焦点光圈，键盘聚焦使用细灰色轮廓。

### 桌面设置页统一样式（全部分类）

账号、外观、终端、命令历史、数据备份、云同步、关于及测试版日志均沿用同一套设置列表样式，以用户确认的通栏分组参考图和数据备份页为基准。

- **页面与分组**：保持整页设置外壳、左侧导航和右侧独立滚动。内容左对齐，最大宽度 1120px，默认左右留白 40px；窗口较窄时缩至 28px / 20px。页面标题 20px / 28px、600 字重；分组标题使用界面字号（默认 14px）、500 字重，标题与分组间距 10–12px，分组之间 28px。禁止把普通设置堆成仪表盘或居中大卡片。
- **分组表面**：浅色采用白色页面与浅灰分组，深色使用对应色阶。分组统一使用 `--surface-app`、1px `--edge-soft` 边界和 `--r-lg`（12px）圆角，不增加厚重投影或大面积强调色。同一分组内使用细分隔线，不为每一行再套卡片。
- **设置行**：标准行最小高度 68px、上下留白 13px、左右留白 16px、说明与控件之间 24px。左侧为名称及其下方说明，右侧为当前值、选择器、输入框或开关；名称使用界面字号与 400 字重，说明为 `max(12px, 界面字号 - 2px)`、1.6 行高。更大字号、长中文说明和长值允许行自然增高，禁止固定高度裁切。
- **紧凑控件与操作**：设置页内输入框、选择器和普通按钮最小高度 30px，使用 `--bg-active`、`--border` 和 `--r-sm`（6px）圆角；常用选择器宽 240px、数字输入宽 80px，均不得超出可用宽度。开关与控件靠右对齐，开关圆点在两种主题下均清晰可见。普通操作使用中性灰按钮，保存、创建、检查更新等操作使用合适内容宽度；不要用通栏蓝色按钮抢占层级。删除等危险操作保留语义色与已有确认流程。侧栏分类、菜单等导航点击行高仍至少 36px。
- **文字与主题**：正文和设置名使用 `--fg`；说明统一使用设置页局部变量 `--settings-muted`，当前为 `color-mix(in srgb, var(--fg) 62%, var(--surface-panel))`。深浅主题的正常说明文字对比度均至少 4.5:1，禁用控件保持可辨认；不得沿用在深色分组上难以辨认的更低对比度文字。颜色调整限定在设置页，不能改变终端配色或独立编辑器。
- **子页签与复杂内容**：备份功能、日志类型等使用同一套横向文字页签、细底线和中性选中指示，支持键盘切换。历史与版本列表在分组内逐行展示，操作紧随对应记录；日志和长列表保留独立滚动。操作多时放到分组底部的紧凑操作栏。开发中、未配置、加载、错误和空记录状态放在对应分组内说明，不用大幅占位插画或空白；账号与官方同步未开放时仍明确标为开发中，不能出现假成功。
- **响应式与无障碍**：以内容区实际宽度决定换行，不假定显示器分辨率。内容区小于 520px 时，较长输入或选择项可转为上下排列并占满该行；开关保持与名称关联，不得溢出。兼容用户字体设置、键盘焦点和减少动态效果；每个表单字段有真实标签关联，纯图标操作有中文无障碍名称。
- **实现与验收**：共用样式集中在 `apps/web/src/styles/settings-page.css`，领域专属布局留在各页样式中，禁止复制分叉同一套控件与配色。新改动限定在 `.desktop-shell .settings-page`；更改后检查所有设置分类的深浅主题、窄窗口、放大字号与实际操作，不用静态截图代替业务验证。未执行的目标平台明确列为待验。

### 原生窗口按钮校验

- macOS 使用 Electron 原生交通灯，通过 `apps/desktop/src/main/windows.ts` 定位；目标按钮中心与内容区顶部 32pt 的工具图标共线，保持系统尺寸与全屏行为，需在最终安装包实测。
- Windows/Linux 在 SSH 工作区上方保留独立窗口栏，工作区整体下移一行，自绘控制按钮不覆盖 SSH 内容；macOS 原生窗口按钮与工具栏共用原布局。
- 旧 AppKit 参考证据保存在阶段 0 报告；新容器的尺寸、按钮点击区、拖动、全屏与恢复由 Electron 安装产物截图和平台实测验收。
