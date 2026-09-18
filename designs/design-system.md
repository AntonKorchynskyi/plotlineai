# PlotlineAI - Design System (Phase 5)

- Status: Complete
- Date: 2026-09-17
- Basis: the **Organic** design system (cream ground, terracotta accent, sage second accent,
  Caprasimo over Figtree, over-rounded shapes)
- Companion artifacts: the `@theme` tokens in `frontend/app/globals.css`, and the clickable
  design prototype covering every screen listed in section 6.

This document is the source of truth for frontend phases 6-8. Screens consume these tokens;
no phase invents its own spacing, type or color values.

## 1. Color

| Token | Value | Use |
|---|---|---|
| `--color-bg` | `#f5ead8` | Page ground. Every screen sits on it. |
| `--color-surface` | `#ebddc5` | Cards, dialogs, the chart surface. |
| `--color-text` | `#201e1d` | Body and heading ink. |
| `--color-accent` | `#c67139` | Primary actions, the first chart series, kickers. |
| `--color-accent-2` | `#7a8a5e` | Second voice: schema chips, success, the second series. |
| `--color-divider` | `#201e1d` at 16% | Rules and control borders. |

Each role carries a 100-900 ramp (`--color-accent-100 … -900`, `--color-accent-2-*`,
`--color-neutral-*`). Rules:

- 100-300 for tinted fills, hovers and soft decorative circles.
- 500 as the role's base.
- 700-900 for text sitting on a tinted fill, and for pressed states.
- Paragraph-size text in the accent uses `--color-accent-700`, never `--color-accent`
  (the base accent clears 3:1, which is enough for chrome and large text only).
- Muted body text is `color-mix(in srgb, var(--color-text) 62-78%, transparent)`.

### Chart palette

One shared categorical palette, used identically in the landing gallery, the suggestion
thumbnails, the result chart and the shared-chart page. Terracotta and sage ramps only:

```
1. #c67139   (accent 500)        4. #aebf92   (accent-2 400)
2. #8fa073   (accent-2 500)      5. #f6a06b   (accent 400)
3. #8c491a   (accent 700)        6. #56633f   (accent-2 700)
```

Single-series charts use colour 1; the second series takes 2, and so on. Doughnut slices
walk the palette in order with a 3px `--color-bg` border between them.

## 2. Type

- Headings: `--font-heading` (Caprasimo 400), `line-height: 1.12`, `letter-spacing: -0.015em`.
- Body and all controls: `--font-body` (Figtree 400/600/700).
- Scale in use: hero 54px, page title 34-36px, section title 30px, card title 17-20px,
  body 15-16px, secondary 13-13.5px, meta and kickers 11-12.5px.
- Kickers and table headers: 10-11px, uppercase, `letter-spacing: 0.08-0.1em`.
- Monospace appears only for the `ChartSpec` panel and share URLs (`ui-monospace`).

Loading the faces is a `frontend/app/layout.tsx` change, replacing the scaffold's Geist pair:

```ts
import { Caprasimo, Figtree } from "next/font/google";

const heading = Caprasimo({ weight: "400", subsets: ["latin"], variable: "--font-heading" });
const body = Figtree({ weight: ["400", "600", "700"], subsets: ["latin"], variable: "--font-sans" });
```

## 3. Spacing, radius, elevation

- Spacing scale (1.10x density): `4.4 / 8.8 / 13.2 / 17.6 / 26.4 / 35.2` px, exposed as
  `--space-1 … --space-8`. Page rhythm on top of it: 26px page gutter, 20-26px grid gap,
  52px hero column gap, 96-120px section separation.
- Content width: 1120px for the landing page, 1040px for `/analyze`, 880px for the shared
  chart and empty result, 760px for upload, 680px for the rejection card.
- Radius: `--radius-sm 8`, `--radius-md 16`, `--radius-lg 28`. Cards and dialogs render at
  `calc(var(--radius-lg) * 1.15)` (~32px); buttons, tags, inputs and the segmented control
  are pills (`999px`). Chart wells inside cards use 18-22px.
- Elevation: `--shadow-sm` for gallery and secondary cards, `--shadow-md` for the hero card
  and the rendered chart, `--shadow-lg` for dialogs only. No ad-hoc box-shadows.

## 4. Components

Use the Organic classes; do not build parallel ones.

| Class | Where it appears in PlotlineAI |
|---|---|
| `.btn` + `.btn-primary` | Upload a CSV, Draw it, Send, Share, Pick another file |
| `.btn-secondary` | Download PNG, refine chips, screen-level secondary actions |
| `.btn-ghost` | Download CSV, Try your own, Replace file |
| `.tag-accent` | Chart-type badge on a suggestion, the "Read only" share badge |
| `.tag-accent-2` | Inferred column chips (`region · string · 5 distinct`) |
| `.tag-neutral` | Row/column counts, gallery chart type |
| `.tag-outline` | Endpoint labels, e.g. `GET /api/backend/gallery` |
| `.card` + `.card-kicker` / `.card-title` / `.card-body`, `.elev-*` | Gallery cards, suggestion cards, the chart surface, the spec panel |
| `.input` | Free-text chart request, refine prompt (min-height 44px) |
| `.nav` + `.nav-brand` | Header: brand mark, Home, Analyze |
| `.table` | Reserved for a future data preview; not used in v1 screens |
| `.dialog` | Reserved for destructive confirmations; not used in v1 screens |

Interaction states come from the system and are not restyled per page: accent-ramp hover and
pressed tints, `:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px }`,
accent `::selection`, 45% opacity when disabled. Pill controls carry `white-space: nowrap`.

### Icons

Lucide, inline SVG on `currentColor`, `stroke-width: 2.75`, 15-26px. In use: `arrow-right`,
`upload`, `download`, `share-2`, `check`, `alert-triangle`, and a bar-chart mark for the brand.

### Decoration

Soft circles from the 200 steps of either ramp, sitting behind the hero card. Icon badges are
circular accent or accent-2 fills, 34-58px, with the glyph in `--color-bg` or a 700-step ink.
No sharp corners, no hairline geometry.

## 5. Chart rendering conventions

`<ChartRenderer>` applies these and nothing else:

- `Chart.defaults.font.family = 'Figtree, system-ui, sans-serif'`,
  `Chart.defaults.color = 'rgba(32,30,29,0.62)'`.
- Grid lines `rgba(32,30,29,0.08)`, no axis border, tick font 12px.
- Legend hidden for single-series charts; otherwise bottom (stacked bar) or right (doughnut),
  circular point style, 10px swatch, 16px padding.
- Bars: `borderRadius: 10` (8 when stacked), `maxBarThickness` 26-58 depending on orientation.
- Lines: 3px stroke, `tension: 0.38`, filled with the accent at 14%, 3px points.
- Doughnut `cutout: 56-58%`.
- `responsive: true`, `maintainAspectRatio: false`. Every canvas sits in a
  `position: relative` wrapper with an explicit height; construct only once the wrapper has a
  non-zero client box, then `resize()` on the next frame.
- Chart well heights: 400px for the result chart, 380px shared, 240px hero and gallery,
  104px suggestion thumbnails.

## 6. Screens

All nine states are designed in the prototype (`PlotlineAI.dc.html`) and are the reference for
implementation:

| Screen | Notes |
|---|---|
| `/` landing | Hero (asymmetric two columns, flush-left heading, washed circles behind a `--shadow-md` card holding the live signups line) over the six-card gallery grid. Each card: chart well, title, chart-type tag, description, Download CSV + Try your own. |
| `/analyze` upload | Centred card wrapping a dashed, 30px-radius accent-100 dropzone with a circular upload badge; caps stated in the sub-label; a three-step Parse / Suggest / Render explainer below. |
| `/analyze` parsing | Accent spinner, file name, three shimmering pill skeletons. |
| `/analyze` thinking | Inline spinner beside the heading and three skeleton suggestion cards. |
| `/analyze` suggestions | Dataset summary card (file name, row/column/null counts, one accent-2 chip per inferred column) then three suggestion cards, each with kicker, chart-type tag, title, one-line rationale and a thumbnail; a free-text card closes the screen with the 500-character note. |
| `/analyze` chart | Kicker + title, Download PNG and Share, the chart on a `--shadow-md` surface, then a two-column row: refine input with chips, and the read-only `ChartSpec` JSON panel on `--color-neutral-100` with a "validated" tag. |
| `/analyze` empty result | Same header, then a centred sage badge, "Nothing left to plot", the reason in plain numbers, and two recovery actions. |
| `/analyze` rejected file | 680px card: accent-200 alert badge, generic reason, the three caps as a plain list, two recovery actions. |
| `/s/[shareId]` | Read-only tag and the share URL in monospace, title, snapshot note about dataset expiry, the chart, then a single call to action. |

## 7. Layout rules

- Left-aligned and asymmetric: headings flush left, whitespace kept on the right; centring is
  reserved for the upload, parsing, empty and rejected states.
- Sibling groups are laid out with flex or grid plus `gap`, never margins between inline items.
- Grids reflow with `repeat(auto-fit, minmax(…, 1fr))`: 360px hero columns, 260px card columns,
  300px for the refine/spec row.
- Give rounded shapes air. No element crowds another; section separation is 96-120px.
