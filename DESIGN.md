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

### 全局无描边规则

桌面页面、独立编辑器及 Portal 弹层统一取消中性的装饰性细描边：灰底分组、服务器条目、图标容器、按钮、输入框、徽标、菜单、提示和弹窗通过底色、留白及柔和外阴影区分层级。不得使用 1px 外描边、内描边或零模糊阴影重建边框；悬停与选中使用底色变化。输入控件保留灰底及必要的错误反馈；结构分隔线、拖放目标、加载旋转图形和错误语义不受此规则影响。前文的 Vercel 参考中涉及边框的描述不适用于桌面界面。

### 区域与尺寸

- 侧栏默认 300px，可在 250–480px 之间拖动调整。功能导航和头像入口最宽 276px，左边距固定 12px；拖宽仅增加右侧留白，拖窄时入口随侧栏一起缩窄，不能突出。头像弹出菜单保持 276px，可悬浮伸出侧栏。拖到 250px 时停顿约 240ms 再收起，停顿期间拉回可取消；收起后继续保留同一次鼠标捕获，仍按住鼠标向右移动 8px 即展开到默认 300px。鼠标尚未追上恢复后的右侧拖拽边缘时保持 300px，触及边缘后再继续跟手调整，保留最初抓取偏移；快速移动越过边缘时直接跟上当前位置。松开后再次移动不会展开，手动点击展开也恢复 300px。服务器列表随侧栏伸缩，新增、编辑等右侧图标继续跟随右边缘。已有保存的宽度、界面字号及字体继续生效，旧宽度限制在新的展开范围内。
- 左上角为原生窗口按钮、折叠侧栏及搜索。macOS 预留 96px 原生交通灯区域；Windows/Linux 窗口控制独立定位于窗口右上角，避免圆角工作区裁切。
- 固定导航依次为新建连接、SFTP 文件、密钥管理、命令片段，纵向排列，行高至少 36px。
- 下方仅保留可滚动、可折叠的服务器分组，占用导航与头像之间的剩余高度；已打开终端通过工作区顶部 Tab 切换，SFTP 与密钥管理各为当前工作空间内的单实例页面，通过功能导航切换且不进入 Tab 栏，不再提供左侧打开列表或列表比例分隔条。
- “服务器”为固定标题，不提供整体收缩；侧栏文件夹的展开状态在当前工作空间本地保存，重启或切换回来后恢复。终端会话、标签和分屏只保留在本次运行中，退出后重新打开为空，不恢复旧标签。
- 服务器与顶部 Tab 采用单行名称，点击区域高度至少 32px；完整名称、地址及状态等元信息通过悬停或键盘聚焦提示显示。
- 新连接窗格内容最大宽度 960px、水平居中，以现有服务器分组为主要层级：保留名称、图标、顺序与父子结构，分组标题显示包含子组的服务器数量并支持独立折叠。组内沿用设置页的浅灰分组表面、12px 圆角和组内细分隔线，服务器以最小 68px 高的双列条目展示名称与连接地址，未分组服务器单列一组；点击整行在当前窗格连接。搜索同时匹配分组路径、服务器名称、地址和用户名，保留匹配项的父组并展开结果。分组内容宽度不超过 600px 时改为单列；标题间距、辅助文字与搜索控件尺寸参考设置页，保留共享字号、深浅主题、键盘焦点底色反馈与图标注册表。
- 服务器、顶部 Tab 与设置分类保留滚轮、触控板及键盘滚动，隐藏可见滚动条。
- 底部仅保留头像、名称和本地/云端标识，点击向上展开设置、主题、同步、账号及关于菜单。
- 工作区外框使用 `--r-xl`（16px），顶部操作区至少 48px；Tab 替换当前页面标题，不增加一行。SSH 与新连接草稿按打开顺序排列；端口映射使用独立单例工具 Tab，固定排在终端 Tab 之后。SFTP、密钥管理不创建 Tab，进入工具页时所有终端 Tab 均不选中，点击终端 Tab 返回原终端。Tab 采用参考图中的浏览器标签样式：默认等宽 216px、至少 32px 高、`--r`（8px）圆角，放大字号时同步增加宽高，窄区域限制单项宽度并横向滚动。SSH 页面顶部栏与底部服务器指标栏统一使用当前 SSH 终端背景色；非选中项透明，选中及悬停底色从当前终端背景与中性前景混合生成，不增加描边或内阴影。文字、图标及收起侧栏后的顶部入口按终端深浅配色适配；选中项与悬停项的关闭图标固定靠右。跟随应用主题时实时响应应用及系统深浅色，显式终端主题保持固定；草稿与工具页顶部栏使用应用语义色阶。每个 SSH Tab 仅显示名称和状态符号：已连接使用 6px 圆点，延迟 ≤100ms 为绿色、>100ms 且 ≤300ms 为黄色、>300ms 为红色；尚无测量值或已断开使用中性灰点，连接中与重连使用轻量加载图标，连接失败使用红色感叹号。具体延迟、状态与错误保留在悬停/键盘聚焦提示中，无障碍名称保留连接状态及延迟，生命周期状态优先于旧延迟。草稿不显示 SSH 状态。底部仅保留轻量服务器指标摘要，不提供通栏底部标签。
- Tab 名称过长时截断，同名会话保留编号；数量过多时单行横向滚动，激活项和窗口尺寸变化后自动露出当前项。尾部始终保留新建连接入口，右侧分屏、详情和更多操作独立于滚动区域。当前、悬停及键盘聚焦项显示关闭按钮，关闭沿用终端资源释放及选中规则；端口映射 Tab 可关闭，关闭仅关闭页面并返回此前终端或连接首页，不停止运行中的映射；关闭当前标签快捷键遵循同一规则。SFTP、密钥管理不提供关闭操作，工具页的关闭快捷键不关闭后台终端。
- 顶部采用 tablist/tab/tabpanel 无障碍关联，左右方向键和 Home/End 切换并移动焦点，沿用已有快捷键。Tab 和新增按钮排除窗口拖动，顶部空白仍可拖动窗口；布局与切换保持终端及 SFTP 挂载。本轮不提供拖拽排序。
- macOS 顶部使用距窗口上边缘 32px 的中心线：侧栏顶部固定 64px，工作区为 8px 留白加 48px 标题栏，低矮窗口也不改变。Windows/Linux 独立窗口栏固定 40px 高，侧栏顶部图标居中；每个窗口按钮为 46×40px，点击区到达窗口上、右边缘，顶部不额外留白。工作区与右侧详情面板从距窗口顶部 40px 处开始，工作区操作区仍至少 48px 高。
- 文件树、资源监控与服务器信息放在右侧详情面板，默认关闭；默认宽 320px，允许 280–480px，空间不足时覆盖在工作区右侧。
- 无会话时展示简洁连接欢迎页，保留产品名、连接说明与常用工具入口；服务器搜索统一通过左上角图标或快捷键进入。

### 图标与文字

- 左侧功能导航、服务器、顶部 Tab、首页快捷入口、弹出菜单采用图标加文字。
- 顶部折叠、搜索、分屏、详情、更多，以及分区新增、条目关闭等工具按钮仅显示图标。
- 页面、列表、详情与编辑器加载统一使用 `ui/loading` 的旋转图标，在容器内居中；局部状态可使用行内尺寸。SFTP 连接与文件列表读取同时展示 2px 中性不定进度条；连接期间显示服务器名称与连接或等待验证状态，目录读取提示仅提供给辅助技术，不显示“正在打开…”或“加载中…”等文字。不显示未经实际进度支持的百分比；遵循系统减少动态效果设置。
- 纯图标按钮必须具有中文无障碍名称，并在悬停、键盘聚焦时展示中文提示；不得用 Tooltip 代替可访问名称。
- Tab 页面名称、分区标题和账号名称保留文字；Tab 连接状态使用符号，完整文字通过提示和无障碍名称提供，不能将整套导航统一缩成图标。
- 图标继续通过既有 server/group/vault 注册表解析。

### 表面与交互

- 浅色采用浅灰窗口/侧栏及工具页顶部栏、白色工作区与灰色导航选中态，深色提供对应色阶。SSH 页顶部栏、选中 Tab、终端及底部指标栏背景同色，文字及悬停态随终端配色适配。颜色使用语义变量，避免大面积强调色与厚重投影。
- 工作区外框统一承担边界，SFTP、密钥页及单终端移除重复外框；内部列表、表单与工具栏继续使用原有控件变量。
- 终端配色控制终端内容、SSH 页顶部栏及底部服务器指标栏，普通导航、工具页及详情浮层沿用应用主题；分屏中的活跃终端可保留低强度光缝。
- 进入分屏只自动收起侧栏一次，始终允许手动展开。未手动调整时退出恢复进入前状态，调整过则保留用户的最新选择。
- 收起侧栏时完整隐藏，展开与搜索入口移到工作区顶部；窗口拖动区域不得覆盖交互控件。
- 点击按钮或使用快捷键展开、收起侧栏，均采用约 220ms 的推动动画：侧栏滑入或滑出，独立占位同步调整宽度，使工作区平滑伸缩。临时悬浮展开后点击固定也推动工作区；实际拖动与向右拉回不施加过渡，立即响应鼠标并打断回缩。减少动态效果设置下跳过动画。
- 点击收起后，鼠标仍停在按钮上时不立即重新触发临时展开；移开并再次悬停才预览。
- 收起后的展开按钮不显示 Tooltip，避免自动恢复焦点时弹出提示。鼠标悬停可临时展开 300px 的覆盖侧栏，以约 180ms 从左向右滑入并淡入；离开后向左滑出并淡出，不改变工作区尺寸及固定展开偏好。进入头像、主题、新增及右键菜单时保持临时侧栏，菜单关闭且鼠标离开后再隐藏；点击展开按钮固定展开。触摸、自动聚焦和仍按住鼠标拖拽时不触发悬停展开。
- 临时侧栏的淡入淡出仅作用于面板，展开与搜索按钮保持同一 DOM 节点、位置及透明度，并始终可操作。两个按钮位于独立固定层，macOS 继续预留 96px 原生窗口按钮区域，覆盖面板不能遮住工具按钮。
- 右侧 SFTP 只显示服务器标识与文件管理，保留目录跟随与滚动状态；“文件管理”为固定标题，不提供收缩，文件区域始终展开；服务器标识、工具栏、路径与文件列表之间使用留白，不加细分割线，路径展示和编辑状态保持透明底色，悬停与聚焦不出现灰色背景；与 SFTP 主页面及文件弹窗共用中性配色，目录图标、跟随按钮、选中行、悬停和路径输入统一使用同一组语义 token，不使用蓝色强调，删除与错误保留危险色。终端底部以轻量摘要展示 CPU、内存、硬盘和网络上下行速率，默认 14px 界面使用 11px、400 字重与统一中性色；图标通过共享注册表提供，服务器信息使用服务器图标。每项悬浮约 300ms 或键盘聚焦后只显示自己的详情，支持移入浮层、Escape 关闭和按项加载状态，不再点击展开聚合页签。“服务器信息”同样通过悬浮查看。摘要每三秒刷新，后台不读取进程、分核和挂载点明细；仅当前悬浮项目每三秒读取详情，离开后停止。请求绑定当前 SSH 会话和空间代次，独立于 SFTP 的服务器级目录缓存；连接中、断开及首次采样前显示“—”。切换终端、工具页、设置或进入后台时停止旧采样，迟到响应不得覆盖当前内容；窄内容区允许换行，浮层不改变工作区尺寸。
- SFTP 与密钥管理首次进入后保持挂载，普通导航保留页面状态；SFTP 内部双栏、服务器标签、多连接及传输队列保持独立功能。从终端打开 SFTP 时在唯一页面内复用服务器连接并定位目录。空间切换先完成编辑器未保存确认，再显式释放旧 SFTP 资源并重置工具页状态。布局调整不卸载已有终端或 SFTP 页面；尺寸变化继续通过终端适配器报告给后端。
- SFTP 主页面只保留左右文件栏之间的 1px 分隔线；标签栏、文件表头、工具按钮分组、传输队列及其明细之间不加细分割线，使用留白分区。
- SFTP 的本机与服务器标签复用 SSH 标签的等宽尺寸、32px 最小高度、圆角、界面字体和关闭按钮样式，新增入口保持在滚动标签列表之外；激活时自动露出当前标签。选中标签使用轻微中性底色，不增加描边或阴影；保留原有拖放目标反馈。空态服务器图标使用透明背景，不添加灰色底座或描边；操作按钮及文件弹窗按钮不使用细描边，保持深浅主题下的中性配色。
- 密钥管理采用左侧紧凑列表、右侧详情与行内表单。列表与详情沿用工作区底色，行内表单使用无描边的 `--surface-app` 分组底色和 `--r-lg`（12px）圆角；顶部、左右栏和内容分组之间以留白区分，不增加贯穿分割线。列表只显示摘要；显示或复制时才读取对应凭据内容，切换条目或离开密钥页面清理已显示的内容。取消或切换有未保存修改的表单时先确认，引用凭据删除前重新检查关联连接。窄内容区改为上下布局并分别滚动，保留共享字号、主题与键盘操作。
- 尊重减少动态效果设置。拖动采用 Pointer Events 和指针捕获，保持跟手，并提供键盘调节。

### 弹层与兼容

- Dialog、AlertDialog、编辑器弹窗、SFTP 选择器与搜索面板继续使用 `--surface-overlay`、`--r-xl` 和无描边的 `--shadow-overlay`。
- 搜索面板的输入区、结果列表与底部快捷键提示使用留白分区，不添加内部细分割线；搜索输入框移除默认阴影，快捷键标签使用轻微底色，不加细描边。
- 关闭搜索面板恢复入口焦点时不自动弹出 Tooltip；之后重新悬停或通过键盘移入入口时正常显示提示。
- SSH 连接弹窗紧凑展示当前真实操作与本次连接耗时，不按预设步骤推断已完成进度。内容通过留白与轻微的背景层次分组，不使用细线分割标题、指纹、故障建议或日志条目。警告图标、失败原因、实际阶段、错误码与建议合并到对应日志条目，不额外占用警报标题行或故障卡片；失败或主机指纹变化时自动展开记录，无法确定原因时明确说明。主机身份确认保留完整指纹与信任操作。正常连接记录默认折叠，允许复制诊断信息，不重复堆叠同一报错或输出凭据、库异常原文。
- 连接弹窗保留一根 4px 的平滑增长进度条，以真实阶段作为视觉位置，在同一阶段内缓慢推进；等待确认或失败时停止，成功才走满，重连重新开始。该条仅表示阶段推进，不展示估算百分比。日志展开后保持约 164px 的紧凑滚动区，自动定位最新报错或警告，完整记录仍可滚动与复制。
- “取消连接”终止当前 SSH 会话及自动重连、收起认证提示，保留标签和服务器引用，允许手动再次连接。取消失败在连接日志中反馈并保留重试入口；关闭标签由标签栏的关闭操作承担。
- 页面操作错误就近放在对应输入、记录或操作栏内，图标与文字同行，沿用 `ui/inline-error`；不在页面或表单内容外另加孤立警报行。传输任务错误通过对应状态查看详情，队列操作错误保留在队列操作栏。安全确认与字段校验保留必要的说明和可访问关联。
- 新增弹窗从共享 DialogContent/AlertDialogContent 继承外框，保留 1rem 视口安全边距。
- 新桌面环境默认界面字号 14px，保持现有桌面组件比例。
- 本地/云端标识来自现有登录态，不表示网络在线状态。本轮账号入口标记开发中，不新增登录注册界面。
- 账号工作区切换必须清理详情缓存、搜索结果与账号相关临时界面状态，布局几何偏好可跨工作区保留。
- 桌面设置使用完整窗口覆盖页，不使用 Dialog、遮罩或居中卡片。左侧 275px 浅灰导航包含返回应用、用户信息和分类，右侧为标题与独立滚动内容；窄窗口缩小侧栏。已有终端与 SFTP 保持挂载，返回后恢复焦点。
- 主导航、设置分类与弹出菜单统一使用界面字号（默认 14px）、400 字重、1.5 行高、至少 36px 点击行高及 16px 图标。更大字号自动撑高，徽标和辅助说明保持次级层级；菜单 Portal 的规则只作用于桌面主窗口。
- 头像弹出菜单默认与入口同宽，入口随窄侧栏缩小时弹出菜单仍保持默认宽度；外观与右键菜单一致，不叠加描边式阴影。桌面控件、弹窗和独立编辑器取消焦点外圈与额外细线描边；文本输入框和多行编辑区聚焦时保持原有底色与单层边界，通过输入光标提示焦点，AI 输入区外层也不加深描边。按钮和选择器的键盘聚焦使用轻微底色变化，菜单沿用行背景反馈。
- 桌面弹出菜单统一沿用右键菜单样式：右键、账号、主题子菜单、新增、更多操作、分屏及下拉选择列表采用最小 200px 宽、12px 圆角、6px 内边距、无描边表面与柔和外阴影；分隔线在两侧缩进，仅用于操作分组，删除操作独立分组并让图标与文字一起使用危险色。图标选择、错误详情等浮层共用相同圆角、边界和阴影，内容尺寸与内边距按原有布局保留。侧栏服务器区标题统一为“服务器”。
- 鼠标悬浮提示及服务器指标详情浮层同样沿用右键菜单的圆角、无描边表面与柔和外阴影，移除菱形和箭头装饰。短提示默认悬停约 300ms 后显示，键盘聚焦可直接显示；与入口保留至少 6px 的默认间距，使用 8px/12px 内边距，默认界面字号下显示 12px 文字并随界面字号增大。长提示最宽 360px，窄窗口内自动换行，连续路径也不能溢出；详情浮层保留原有内容布局、移入查看及 Escape 关闭行为，不强制套用菜单的最小宽度与点击行高。
- 共用次要按钮（包括确认弹窗中的“取消”）采用中性灰填充和透明边界，悬停时用背景色变化反馈，避免文字色形成高亮细描边；键盘聚焦使用轻微底色反馈。深浅主题使用同一套语义 token。

### 密钥管理

- 密钥管理采用无框双栏：左侧凭据列表与右侧详情共用工作区底色，不使用灰底分组卡片或外框。列表仅对选中条目提供轻微中性底色；私钥、公钥、口令及关联连接通过留白和细分隔线分组，隐藏内容保持单行高度，显示后按内容展开并限制长内容高度。顶部标题与创建操作、类型筛选与搜索分为两行，类型使用“全部 / 密码 / 私钥”按钮组。顶部与空态的“新建凭据”使用黑底白字、无描边按钮，深色主题按前景与面板语义色反转；创建/保存、取消及生成器应用按钮使用中性灰底、无描边样式。悬停和键盘聚焦仅通过底色变化反馈。
- 没有凭据或筛选无结果且未编辑时，空态横跨整个内容区居中，不保留右侧详情占位；进入新建、编辑或有凭据后使用双栏布局。
- 生成密钥对融入新建凭据表单：选择私钥类型后提供 ED25519、RSA 2048/4096、私钥口令和公钥注释；生成结果填入当前表单，统一通过“创建”保存。页面不再提供单独的生成入口或弹窗，保留手动输入、导入、导出及公钥复制操作。
- 凭据表单的灰底分组、填充式输入框和次要按钮不叠加细描边，以底色区分层级；密码生成器直接融入密码分组，不再套一层边框。滑块、勾选框及应用按钮使用随深浅主题适配的中性色，不使用蓝色强调或悬停光圈。
- 未保存修改的确认弹窗使用紧凑宽度、左对齐标题及常规字重按钮；两个操作均采用无描边中性灰底，放弃操作略微加深，不使用蓝色按钮。Portal 内容单独限定桌面样式，保留原有焦点管理及确认行为。

### 命令片段

- 空列表、搜索无结果、加载和错误状态使用统一的居中内容，不保留空列表侧栏或右侧详情提示。没有匹配片段时缩小弹窗，避免固定双栏产生大面积空白；有内容后恢复双栏。搜索无结果提供清除搜索入口，空列表提供新建入口。
- 新建片段使用黑底白字、无描边按钮，并随深浅主题调整对比；其他普通按钮使用中性灰底。灰底表单、代码区域、标签、输入框和按钮不叠加细描边，列表沿用工作区底色，以轻微中性底色标识选中项。

### 桌面设置页统一样式（全部分类）

账号、外观、终端、命令历史、数据备份、云同步、关于及测试版日志均沿用同一套设置列表样式，以用户确认的通栏分组参考图和数据备份页为基准。

- **页面与分组**：保持整页设置外壳、左侧导航和右侧独立滚动。内容左对齐，最大宽度 1120px，默认左右留白 40px；窗口较窄时缩至 28px / 20px。页面标题 20px / 28px、600 字重；分组标题使用界面字号（默认 14px）、500 字重，标题与分组间距 10–12px，分组之间 28px。禁止把普通设置堆成仪表盘或居中大卡片。
- **分组表面**：浅色采用白色页面与浅灰分组，深色使用对应色阶。分组统一使用 `--surface-app` 和 `--r-lg`（12px）圆角，不叠加外描边，不增加厚重投影或大面积强调色。设置页及其附属弹窗内不使用行间细线、标题隔断、操作栏分隔或导航隔断，通过原有行高、留白与灰底分组区分内容，不为每一行再套卡片。
- **设置行**：标准行最小高度 68px、上下留白 13px、左右留白 16px、说明与控件之间 24px。左侧为名称及其下方说明，右侧为当前值、选择器、输入框或开关；名称使用界面字号与 400 字重，说明为 `max(12px, 界面字号 - 2px)`、1.6 行高。更大字号、长中文说明和长值允许行自然增高，禁止固定高度裁切。
- **紧凑控件与操作**：设置页内输入框、选择器和普通按钮最小高度 30px，使用 `--bg-active` 和 `--r-sm`（6px）圆角，不加装饰性描边；常用选择器宽 240px、数字输入宽 80px，均不得超出可用宽度。开关与控件靠右对齐，开关圆点在两种主题下均清晰可见。普通操作使用中性灰按钮，保存、创建、检查更新等操作使用合适内容宽度；不要用通栏蓝色按钮抢占层级。删除等危险操作保留语义色与已有确认流程。侧栏分类、菜单等导航点击行高仍至少 36px。
- **文字与主题**：正文和设置名使用 `--fg`；说明统一使用设置页局部变量 `--settings-muted`，当前为 `color-mix(in srgb, var(--fg) 62%, var(--surface-panel))`。深浅主题的正常说明文字对比度均至少 4.5:1，禁用控件保持可辨认；不得沿用在深色分组上难以辨认的更低对比度文字。颜色调整限定在设置页，不能改变终端配色或独立编辑器。
- **子页签与复杂内容**：备份功能、日志类型等使用同一套横向文字页签，以中性底色标识悬停和选中，不添加底线或下划线，支持键盘切换。历史与版本列表在分组内逐行展示，操作紧随对应记录；日志和长列表保留独立滚动。操作多时放到分组底部的紧凑操作栏。开发中、未配置、加载、错误和空记录状态放在对应分组内说明，不用大幅占位插画或空白；账号与官方同步未开放时仍明确标为开发中，不能出现假成功。
- **响应式与无障碍**：以内容区实际宽度决定换行，不假定显示器分辨率。内容区小于 520px 时，较长输入或选择项可转为上下排列并占满该行；开关保持与名称关联，不得溢出。兼容用户字体设置、键盘焦点和减少动态效果；每个表单字段有真实标签关联，纯图标操作有中文无障碍名称。
- **实现与验收**：共用样式集中在 `apps/web/src/styles/settings-page.css`，领域专属布局留在各页样式中，禁止复制分叉同一套控件与配色。新改动限定在 `.desktop-shell .settings-page`；更改后检查所有设置分类的深浅主题、窄窗口、放大字号与实际操作，不用静态截图代替业务验证。未执行的目标平台明确列为待验。

### 同步冲突合并工作台

- 云同步设置页仅展示冲突数量和“处理冲突”入口；条目列表、差异选择、结果预览及应用操作全部放在独立 Dialog，不在设置页逐条展开。
- Dialog 使用左侧冲突列表、中间字段对照、右侧合并结果；默认只展示变化字段，相同字段折叠。沿用中性色、中文文案和紧凑控件，窄窗口调整为上下布局，保留键盘焦点与 Escape 关闭。
- Dialog 的 Portal 独立继承深浅主题中性色阶。条目名称单行省略并提供完整提示；整条采用与逐字段选择均显示选中底色和勾选。删除冲突使用并排的版本卡片，明确区分保留删除与恢复条目，并展示可恢复版本摘要；暂存状态与尚未应用的数量清晰可见。
- 支持逐字段选择、整条采用一侧及服务器保留双方副本。认证与凭据、高级连接配置按组选择；前端只提交字段来源，凭据正文留在数据库 Worker。服务器主机指纹属于本机信任记录，不参与同步差异、合并选择或上传。
- 关闭 Dialog 保留当前账号内已暂存的选择，切换账号丢弃旧选择。确认前不写入；应用前复核本机修订和远端版本，所选结果及关联图在同一事务中提交，失败整批回滚。自动同步暂停时，处理冲突不会打开自动同步。

### 原生窗口按钮校验

- macOS 使用 Electron 原生交通灯，通过 `apps/desktop/src/main/windows.ts` 定位；目标按钮中心与内容区顶部 32pt 的工具图标共线，保持系统尺寸与全屏行为，需在最终安装包实测。
- Windows/Linux 在 SSH 工作区上方保留独立窗口栏，工作区整体下移一行，自绘控制按钮不覆盖 SSH 内容；macOS 原生窗口按钮与工具栏共用原布局。
- 旧 AppKit 参考证据保存在阶段 0 报告；新容器的尺寸、按钮点击区、拖动、全屏与恢复由 Electron 安装产物截图和平台实测验收。

### 独立文件编辑器

- 使用编辑器专属顶部栏，将文件名、未保存标记、完整路径与比较、另存为、重新加载、保存放在同一行。顶部不再额外叠加产品通用标题栏；多文件标签留在下方内容区。
- 顶部至少 64px，macOS 隐藏系统标题文字并保留原生交通灯，左侧预留 88px；Windows/Linux 窗口按钮沿用 46×64px 点击区。文件信息与留白可拖动窗口，操作按钮排除拖动，关闭继续经过未保存确认。
- 外壳采用 `--surface-app`，内容、行号栏和状态栏采用 `--surface-workspace`，搭配中性按钮、细边界与 `--r-lg` 圆角。编辑器辅助文字使用局部中性色阶，保存和未保存标记不使用大面积蓝色。
- Monaco 在首次创建前从当前主题变量生成配色；深浅主题、系统主题和其他窗口设置变更时更新背景、文字、选区、提示面板、查找输入及滚动条，不重新创建编辑模型。代码语法着色保留 Monaco 的对应深浅色规则。
- 路径允许截断并保留完整提示；窄窗口隐藏保存快捷键提示，为文件操作保留空间。尊重界面字号、键盘焦点与减少动态效果设置。

### 数据备份

- 数据备份只保留“自动备份”和“文件导入与导出”，删除版本列表、版本恢复、保留版本数、完整恢复、安全快照及备份历史事件。
- 自动备份先将加密 `.eizhubackup` 文件原子保存到用户选择的本地目录，支持变更防抖、定时及正常退出。目录由主进程原生选择，渲染端不能提交任意写入路径。
- 有已启用第三方目标时上传同一个新文件；没有目标时只保存本地。保留目标配置和 OAuth；既有云端备份及索引不读取、修改或删除。上传失败明确显示本地文件已经保存。
- 文件导入继续兼容 `.eizhubackup` / `.xcbackup` 及三种凭据模式，保留预览、冲突策略和事务回滚。备份文件由用户管理，不再在数据库维护版本正文或目录。

### SSH 端口映射

- 左侧“SFTP 文件”下方提供“端口映射”，原隧道管理菜单和 Ctrl/Cmd+Shift+L 均打开同一页面。仅增加此工具的单例标签，不把它建模成 SSH 会话。
- 页面顶部提供新增、搜索、类型和状态筛选；紧凑规则列表展示名称、服务器、类型、两端位置、状态、活动连接及操作。区分本机监听/服务器监听与目标所在网络，IPv6 端点带方括号；端口 0 启动后显示并复制实际分配端口。
- 保持中性配色，以留白和轻微底色区分层次，不使用大卡片、额外分隔线或焦点外圈。窄内容区操作换行，长名称和地址换行，支持放大字号和键盘操作。
- 新增和编辑使用紧凑弹窗，监听默认使用回环地址，可选择 0.0.0.0 / :: 对外监听。选择对外监听时说明局域网/公网暴露风险；每次手动启动再弹出独立确认，列出名称、SSH 服务器、监听与目标位置，动态代理额外说明无客户端认证。确认只针对本次运行，不提供永久跳过提醒。监听端口必填且允许 0，目标端口必填；动态代理隐藏目标字段。保存不启动，未保存修改关闭前确认。操作错误留在对应规则，保存错误留在表单；运行中的规则先停止再编辑。
- 普通导航保留筛选，离开页面解除状态订阅，重新进入读取快照；关闭页面不释放 SSH 映射，空间切换和应用退出由业务进程释放。运行中表示 SSH 和监听就绪，不表示目标服务健康检查通过。
- 映射表单按方向标注字段：本地映射为“本机监听地址/端口”和“远端目标主机/端口”；远端映射为“服务器监听地址/端口”和“本机侧目标主机/端口”；动态代理不提供固定目标。三种模式各自保留当前表单草稿，切换类型不复用另一方向的地址和端口，切回时恢复输入。所有模式的监听地址均提供 0.0.0.0 / ::，目标字段填写具体 IP 或域名；说明 127.0.0.1 在两个方向指向不同机器。
- 端口映射页面、表单和确认弹窗显式使用应用 `--sans-size` 与 `--sans`，不依赖 Portal 的浏览器默认字号；表单控件最小高度 30px。监听地址选项只显示地址；目标主机采用可输入的地址框，提供 127.0.0.1、::1、localhost 和当前自定义值，下拉选择后焦点回到输入框。
- 表单右侧显示映射流向预览，随当前模式、SSH 服务器、监听与目标输入即时更新。本地映射从本机流向服务器与远端目标，远端映射反向流向本机侧目标，动态代理展示由 SSH 服务器到多个客户端指定目标的分流。动画为配置示意，不代表连接成功或真实业务流量；系统减少动态效果时保留静态路径。窄窗口将预览放在字段之后，表单内容可滚动，操作按钮保持可见。
- 流向预览采用“纵向接力”：沿左侧竖直路径按实际转发顺序排列监听端、SSH 接收端与目标，名称和地址放在图标右侧。本地映射与动态代理从本机向下到服务器，远端映射从服务器向下到本机。单段动画约 4.8 秒，经过节点时短暂停留，末端留出静止间隔；不使用呼吸或缩放。SOCKS5 在下方分出三个示意目标，每次仅沿一个分支移动，并依次轮换。图标和地址直接呈现在预览底色上，不增加独立卡片；保留“非实时流量”说明，减少动态效果时仅显示静态路径。
- 映射表单宽度上限 960px，为右侧预览保留独立空间；预览采用 18px 内边距，标题、画布与底部说明间隔 16px。节点之间及图标、名称、地址之间增加留白，保持紧凑字号；窄屏上下布局允许内容自然滚动。
