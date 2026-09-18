# designs/ — PlotlineAI Phase 5

The design pass that Phase 5 of `docs/superpowers/specs/2026-08-26-plotlineai-design.md`
requires. Frontend phases 6-8 build against these files.

| File | What it is |
|---|---|
| `plotlineai-prototype.html` | Clickable prototype, self-contained — open it in a browser, no server needed. All nine screens, switchable from the Screens bar or by clicking through the flow. Charts are real Chart.js renders computed from the six CSVs in `backend/src/main/resources/gallery/`. |
| `design-system.md` | The written design system: color roles and ramps, the shared chart palette, type scale, spacing/radius/elevation, component and icon usage, Chart.js conventions, per-screen notes, layout rules. Copy to `docs/design-system.md`. |
| `globals.css` | Drop-in replacement for `frontend/app/globals.css` — the Tailwind v4 `@theme` tokens. |
| `source/` | Editable source of the prototype (`PlotlineAI.dc.html` plus its runtime and the Organic design-system stylesheet). Edit here and re-export if the designs change. |

## Screens covered

Landing + gallery · Upload · Parsing · Suggestions · Thinking · Chart + refine ·
Shared link (`/s/[shareId]`) · Rejected file · Empty result

## Notes for Phase 6

- The type pairing is Caprasimo (headings) over Figtree (body), which replaces the scaffold's
  Geist pair in `frontend/app/layout.tsx`. The `next/font` snippet is in `design-system.md`.
- There is no dark scheme; the warm light ground is the only theme.
- `<ChartRenderer>` should apply only the conventions in section 5 of `design-system.md` —
  the palette, grid and legend rules are shared by the gallery, the result chart and shares.
