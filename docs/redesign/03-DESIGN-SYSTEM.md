# 03 - Design System Spec

**Status:** Proposal (no app code changed) | **Implements:** `docs/REDESIGN-PROPOSAL-ROLE-BASED-UX.md` section 6 | **Tokens:** `docs/redesign/tokens.css`

Stack: Next.js 16 + Tailwind 4. Tokens are CSS custom properties exposed to Tailwind through `@theme inline`, so `bg-panel`, `text-muted`, `text-bad-text`, `bg-ok-bg`, `rounded-md` work and follow the theme at runtime. Read `node_modules/next/dist/docs/` before wiring layout/script changes (AGENTS.md: this Next.js has breaking changes).

## 1. Principles applied to the system

1. Colour only carries state that needs action; everything else is neutral (proposal principle 4).
2. Status is never colour alone: every status has an icon and a text label.
3. Light and dark are at parity: same token names, every pair verified (section 2).
4. Legacy names (`--bg --panel --panel-2 --border --text --muted --faint --accent --ok --warn --bad --neutral --prod --accent-rgb`) are kept so current pages keep rendering while components migrate.

## 2. Colour tokens

### 2.1 Palette

VidAI brand coral `#e17e61` (today's `--accent`) is kept as `--brand` and used for fills. On light surfaces it only reaches 2.85:1 against white, so the *UI accent* (focus ring, borders, links-as-icons) is the darker `--accent` `#c2512f` in light and the original `#e17e61` in dark. Brand-filled buttons use dark ink `--on-brand` `#151c28` (5.99:1), not white (2.85:1).

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `--bg` | `#f6f8fb` | `#151c28` | page |
| `--panel` | `#ffffff` | `#1e2737` | cards, drawer, nav |
| `--panel-2` | `#eef2f7` | `#242f42` | hover, zebra, inset |
| `--text` | `#172033` | `#e8edf5` | primary text |
| `--muted` | `#4b5a70` | `#94a3b8` | secondary text |
| `--faint` | `#5b6a80` | `#8f9db3` | tertiary text, timestamps (today's `#64748b` fails on panel-2 in dark; raised) |
| `--accent` / `--accent-text` | `#c2512f` / `#a63f22` | `#e17e61` / `#f0a28d` | focus ring, borders / accent text |
| `--brand`, `--on-brand` | `#e17e61`, `#151c28` | same | brand fills + text on them |

Semantic status (each has `--x` for dots/icons/borders, `--x-text` for text, `--x-bg` tint, `--x-border`):

| Status | Meaning in tracker | Light (solid / text / bg) | Dark (solid / text / bg) |
|--------|--------------------|---------------------------|--------------------------|
| success (`ok`) | deployed, healthy, QA passed | `#15803d` / `#166534` / `#e3f0e8` | `#4ade80` / `#6ee7a0` / `#254443` |
| warning (`warn`) | in progress, drift, stuck, degraded | `#b45309` / `#8a4204` / `#f6eae1` | `#fbbf24` / `#fcd34d` / `#413f34` |
| danger (`bad`) | failed, blocked, rolled back, down | `#dc2626` / `#b91c1c` / `#fbe5e5` | `#f87171` / `#fca5a5` / `#413340` |
| info | queued, informational, hotfix tag | `#2563eb` / `#1d4ed8` / `#e5ecfd` | `#60a5fa` / `#93c5fd` / `#293b56` |
| neutral | not deployed, unknown, skipped | `#64748b` / `#475569` / `#eceef1` | `#94a3b8` / `#b6c2d3` / `#313b4c` |

Rule: **never put `--x` solid colour on small text.** Use `--x-text` for any text under 24 px / 19 px bold. Solids are for 3:1 non-text elements (dots, icons, borders, sparkline strokes).

### 2.2 Verified contrast (WCAG 2.2 AA)

Computed with the WCAG relative-luminance formula (sRGB, 2.4 gamma) in a script over the exact hex values in `tokens.css`. Thresholds: 4.5:1 text, 3:1 non-text/UI (SC 1.4.11). The tint `--x-bg` is the status colour alpha-blended over `--panel` (12 percent light, 16 percent dark) and stored as a fixed hex so the ratio is exact. All 70 pairs pass.

| Foreground | Background | Ratio | Required | Result |
|------------|------------|-------|----------|--------|
| **Light theme** | | | | |
| --text #172033 | bg #f6f8fb | 15.29 | 4.5:1 | Pass |
| --text #172033 | panel #ffffff | 16.27 | 4.5:1 | Pass |
| --text #172033 | panel2 #eef2f7 | 14.47 | 4.5:1 | Pass |
| --muted #4b5a70 | bg #f6f8fb | 6.59 | 4.5:1 | Pass |
| --muted #4b5a70 | panel #ffffff | 7.01 | 4.5:1 | Pass |
| --muted #4b5a70 | panel2 #eef2f7 | 6.24 | 4.5:1 | Pass |
| --faint #5b6a80 | bg #f6f8fb | 5.17 | 4.5:1 | Pass |
| --faint #5b6a80 | panel #ffffff | 5.50 | 4.5:1 | Pass |
| --faint #5b6a80 | panel2 #eef2f7 | 4.89 | 4.5:1 | Pass |
| --accentT #a63f22 | bg #f6f8fb | 5.88 | 4.5:1 | Pass |
| --accentT #a63f22 | panel #ffffff | 6.26 | 4.5:1 | Pass |
| --accentT #a63f22 | panel2 #eef2f7 | 5.57 | 4.5:1 | Pass |
| --on-accent (ink) #151c28 | brand fill #e17e61 | 5.99 | 4.5:1 | Pass |
| --accent (focus ring/borders) #c2512f | bg #f6f8fb | 4.37 | 3:1 | Pass |
| --accent (focus ring/borders) #c2512f | panel #ffffff | 4.65 | 3:1 | Pass |
| --ok-text #166534 | ok tint #e3f0e8 #e3f0e8 | 6.08 | 4.5:1 | Pass |
| --ok-text #166534 | panel #ffffff | 7.13 | 4.5:1 | Pass |
| --ok (dot/icon) #15803d | panel #ffffff | 5.02 | 3:1 | Pass |
| --ok (dot/icon) #15803d | bg #f6f8fb | 4.71 | 3:1 | Pass |
| --warn-text #8a4204 | warn tint #f6eae1 #f6eae1 | 6.21 | 4.5:1 | Pass |
| --warn-text #8a4204 | panel #ffffff | 7.34 | 4.5:1 | Pass |
| --warn (dot/icon) #b45309 | panel #ffffff | 5.02 | 3:1 | Pass |
| --warn (dot/icon) #b45309 | bg #f6f8fb | 4.72 | 3:1 | Pass |
| --bad-text #b91c1c | bad tint #fbe5e5 #fbe5e5 | 5.37 | 4.5:1 | Pass |
| --bad-text #b91c1c | panel #ffffff | 6.47 | 4.5:1 | Pass |
| --bad (dot/icon) #dc2626 | panel #ffffff | 4.83 | 3:1 | Pass |
| --bad (dot/icon) #dc2626 | bg #f6f8fb | 4.54 | 3:1 | Pass |
| --info-text #1d4ed8 | info tint #e5ecfd #e5ecfd | 5.66 | 4.5:1 | Pass |
| --info-text #1d4ed8 | panel #ffffff | 6.70 | 4.5:1 | Pass |
| --info (dot/icon) #2563eb | panel #ffffff | 5.17 | 3:1 | Pass |
| --info (dot/icon) #2563eb | bg #f6f8fb | 4.86 | 3:1 | Pass |
| --neu-text #475569 | neu tint #eceef1 #eceef1 | 6.52 | 4.5:1 | Pass |
| --neu-text #475569 | panel #ffffff | 7.58 | 4.5:1 | Pass |
| --neu (dot/icon) #64748b | panel #ffffff | 4.76 | 3:1 | Pass |
| --neu (dot/icon) #64748b | bg #f6f8fb | 4.47 | 3:1 | Pass |
| **Dark theme** | | | | |
| --text #e8edf5 | bg #151c28 | 14.54 | 4.5:1 | Pass |
| --text #e8edf5 | panel #1e2737 | 12.75 | 4.5:1 | Pass |
| --text #e8edf5 | panel2 #242f42 | 11.45 | 4.5:1 | Pass |
| --muted #94a3b8 | bg #151c28 | 6.67 | 4.5:1 | Pass |
| --muted #94a3b8 | panel #1e2737 | 5.85 | 4.5:1 | Pass |
| --muted #94a3b8 | panel2 #242f42 | 5.25 | 4.5:1 | Pass |
| --faint #8f9db3 | bg #151c28 | 6.22 | 4.5:1 | Pass |
| --faint #8f9db3 | panel #1e2737 | 5.46 | 4.5:1 | Pass |
| --faint #8f9db3 | panel2 #242f42 | 4.90 | 4.5:1 | Pass |
| --accentT #f0a28d | bg #151c28 | 8.35 | 4.5:1 | Pass |
| --accentT #f0a28d | panel #1e2737 | 7.32 | 4.5:1 | Pass |
| --accentT #f0a28d | panel2 #242f42 | 6.57 | 4.5:1 | Pass |
| --on-accent (ink) #151c28 | brand fill #e17e61 | 5.99 | 4.5:1 | Pass |
| --accent (focus ring/borders) #e17e61 | bg #151c28 | 5.99 | 3:1 | Pass |
| --accent (focus ring/borders) #e17e61 | panel #1e2737 | 5.25 | 3:1 | Pass |
| --ok-text #6ee7a0 | ok tint #254443 #254443 | 6.85 | 4.5:1 | Pass |
| --ok-text #6ee7a0 | panel #1e2737 | 9.71 | 4.5:1 | Pass |
| --ok (dot/icon) #4ade80 | panel #1e2737 | 8.60 | 3:1 | Pass |
| --ok (dot/icon) #4ade80 | bg #151c28 | 9.81 | 3:1 | Pass |
| --warn-text #fcd34d | warn tint #413f34 #413f34 | 7.34 | 4.5:1 | Pass |
| --warn-text #fcd34d | panel #1e2737 | 10.40 | 4.5:1 | Pass |
| --warn (dot/icon) #fbbf24 | panel #1e2737 | 8.98 | 3:1 | Pass |
| --warn (dot/icon) #fbbf24 | bg #151c28 | 10.24 | 3:1 | Pass |
| --bad-text #fca5a5 | bad tint #413340 #413340 | 6.24 | 4.5:1 | Pass |
| --bad-text #fca5a5 | panel #1e2737 | 7.90 | 4.5:1 | Pass |
| --bad (dot/icon) #f87171 | panel #1e2737 | 5.42 | 3:1 | Pass |
| --bad (dot/icon) #f87171 | bg #151c28 | 6.18 | 3:1 | Pass |
| --info-text #93c5fd | info tint #293b56 #293b56 | 6.28 | 4.5:1 | Pass |
| --info-text #93c5fd | panel #1e2737 | 8.31 | 4.5:1 | Pass |
| --info (dot/icon) #60a5fa | panel #1e2737 | 5.90 | 3:1 | Pass |
| --info (dot/icon) #60a5fa | bg #151c28 | 6.72 | 3:1 | Pass |
| --neu-text #b6c2d3 | neu tint #313b4c #313b4c | 6.26 | 4.5:1 | Pass |
| --neu-text #b6c2d3 | panel #1e2737 | 8.32 | 4.5:1 | Pass |
| --neu (dot/icon) #94a3b8 | panel #1e2737 | 5.85 | 3:1 | Pass |
| --neu (dot/icon) #94a3b8 | bg #151c28 | 6.67 | 3:1 | Pass |

Not covered / caveats: `--x-text` on `--x-bg` is verified over `--panel`; a pill placed on `--panel-2` or `--bg` is a slightly different backdrop but the text-vs-panel rows (6.5 to 10.4) leave wide margin. Re-run the check whenever a token changes (a 20-line script is sufficient; add it as a CI test in the build phase).

### 2.3 Dark-mode and theme mechanics

`tokens.css` ships light in `:root`, dark in `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) }` and again in `:root[data-theme='dark']`. The theme toggle keeps today's `localStorage` key **`tracker-theme`** (`'light' | 'dark'`). To avoid a flash, an inline script in `<head>` of `app/layout.tsx` runs before paint: read the key in try/catch, set `document.documentElement.dataset.theme`. If nothing is stored, today's behaviour is dark; set `data-theme='dark'` in that case, or omit it to follow the OS (**decision for the owner; default proposed: follow the OS**). Today's `.wrap.dark/.wrap.light` classes in `page.tsx` are replaced by the root attribute. The toggle is a 3-state control only if the product wants "system"; otherwise keep 2-state and remove the key to mean "system".

### 2.4 Chart colours

Sparklines and DORA charts use `--accent` for the primary series, `--muted` for comparison, status colours only when the series *is* a status. Never rely on hue alone: add direct labels or dashed vs solid stroke.

## 3. Typography

Brand font stays Montserrat (already loaded) with Inter and the system stack as fallback; the proposal asks for a system UI stack, so font loading can be dropped later without layout change because metrics are set per size below. `font-variant-numeric: tabular-nums` (`.tnum`) on every count, duration, version, timestamp.

| Token | Size / line | Weight | Use |
|-------|-------------|--------|-----|
| `text-2xs` | 11 / 16 | 600, uppercase +0.04em | column eyebrow, pill count badge |
| `text-xs` | 12 / 16 | 500 | meta, timestamps, helper text |
| `text-sm` | 13 / 20 | 400-600 | **data**: tables, chips, pills, cards |
| `text-base` | 14 / 22 | 400 | **body**, drawer prose |
| `text-md` | 16 / 24 | 600 | section heading, drawer title |
| `text-lg` | 18 / 26 | 600 | page heading (mobile) |
| `text-xl` | 22 / 28 | 700 | page heading |
| `text-2xl` | 28 / 34 | 700, tnum | stat tile value |

Mono (`--font-code`) is for ticket keys, SHAs, versions. Body text min 14 px; 11 px only for non-essential eyebrow labels. Respect user zoom (use rem in the implementation: 13px = 0.8125rem); layouts must survive 200 percent zoom (SC 1.4.4) and 320 px reflow (SC 1.4.10).

## 4. Spacing, radii, elevation, motion

- **Spacing** is a 4 px scale: `space-1..12` = 4, 8, 12, 16, 20, 24, 32, 40, 48. Component padding uses density tokens, not raw values.
- **Radii:** `xs` 4 (version chip, kbd), `sm` 6 (buttons, inputs, chips), `md` 10 (cards, tiles), `lg` 14 (drawer leading corners, palette), `pill` 999 (status pill, health dot).
- **Elevation:** `--elev-1` cards at rest (optional; borders are primary), `--elev-2` drawer, palette, toast. In dark, separation is by `--border` plus panel step, not shadow.
- **Layers:** nav 20, drawer 40, command palette 50, toast 60.
- **Motion:** 120 ms (hover), 200 ms (drawer slide, accordion) with `--ease`. Motion only signals state change: in-progress pulse (1.6 s), drawer slide, skeleton shimmer. `prefers-reduced-motion: reduce` collapses all durations and replaces shimmer with a flat fill; pulse becomes static (the pill keeps its spinner-free "In progress" label).

## 5. Density

Set on `<html data-density="comfortable|compact">`, persisted under `tracker-density`, default comfortable. A toggle sits in the account menu and in the table/board toolbar.

| Token | Comfortable | Compact |
|-------|-------------|---------|
| `--row-h` (table row, list item) | 44 | 32 |
| `--ctl-h` (button, input, chip) | 36 | 28 |
| `--pad-card` | 16 | 10 |
| `--gap-stack` | 16 | 8 |
| `--pad-cell` (y / x) | 10 / 12 | 5 / 8 |

Font sizes do not change with density (only space does). On `(pointer: coarse)` compact is overridden to 44 px targets (SC 2.5.8 requires at least 24 px; we target 44). Applies to: tables, Pipeline board cards, filter chips, ticket cards. It does **not** apply to the drawer or nav.

## 6. Responsive and layout

| Breakpoint | Shell | Pipeline | Tables |
|------------|-------|----------|--------|
| < 640 | bottom tab bar (56 px), top bar slim | per-env accordion | collapse to ticket cards |
| 640-1023 | collapsed icon rail (64 px) | horizontal scroll columns, snap | table, secondary columns hidden |
| >= 1024 | full sidebar (232 px) | all columns | full table |
| >= 1536 | content max-width 1600 px, centred | | |

Use `100dvh`, `env(safe-area-inset-bottom)` for the tab bar, no horizontal page scroll except inside the board scroller.

## 7. Global keyboard map

| Key | Action | Notes |
|-----|-----|-------|
| `Cmd/Ctrl + K` | open command palette (global search) | `preventDefault`; works from any focus incl. inputs; toggles closed if open |
| `/` | focus the page search / filter input | ignored when typing in a field |
| `Esc` | close the top-most layer: order: palette, then popover or menu, then drawer | one layer per press; focus returns to trigger |
| `g` then `h/p/t/r/i/e` | go to Home, Pipeline, Tickets, Releases, Insights, hEalth | 800 ms chord window; disabled in fields; discoverable in palette |
| `?` | shortcut help dialog | |
| `j` / `k` | next / previous row or card in a list | roving tabindex; `Enter` opens drawer |
| `r` | refresh data now | announces via live region "Updated just now" |
| Arrow keys | within toolbar, tabs, segmented controls, board columns | roving tabindex, APG patterns |

Single-letter shortcuts are suppressed when focus is in an input, textarea, select, contenteditable, or when a modifier is held (SC 2.1.4); each can be turned off in Settings. The whole app is operable without a pointer.

## 8. Components

Conventions: each component lists **Anatomy, Props (TypeScript), States, A11y**. All colours come from tokens. "Hit target" means the interactive box, at least `--ctl-h` and never under 24 px (44 on touch).

### 8.1 Status pill

Shows the state of a deployment, ticket stage or check. Read-only.

**Anatomy:** `[icon 12px][label]` in a pill (`--r-pill`, height 22 px, padding 0 8 px, `text-xs` 600), background `--x-bg`, 1 px `--x-border`, text and icon `--x-text`.

| Status | Icon | Default label |
|--------|------|---------------|
| success | check-circle | Deployed / Passed / Healthy |
| warning | alert-triangle | Drift / Stuck 5d / Degraded |
| danger | x-circle | Failed / Blocked / Rolled back |
| info | info or clock | Queued / Hotfix |
| info (pause glyph) | pause `⏸︎` | Awaiting approval (open, waiting for DevOps approval) |
| warning (slashed-circle glyph) | `⊘` | Rejected (approval declined; final, never ran) |
| neutral | minus-circle | Not deployed / Unknown |
| progress (warning family) | spinner (static under reduced motion) | In progress |

**Props:** `status: 'success'|'warning'|'danger'|'info'|'neutral'|'progress'`, `label: string` (required, no icon-only), `icon?: ReactNode` (override), `size?: 'sm'|'md'`, `title?: string`.
**States:** static only. `progress` pulses the icon (`.pulse`). Truncate label with ellipsis at 24 ch with `title`.
**A11y:** renders as `<span>`; text is the accessible name; icon is `aria-hidden`. Not focusable. If it conveys a change (poll result), the surrounding list uses `aria-live="polite"`, not the pill.

### 8.2 Stat tile with sparkline

KPI such as deploy frequency, lead time, change-failure rate, open bugs.

**Anatomy:** card (`--r-md`, `--pad-card`): eyebrow label (`text-2xs`), value (`text-2xl` tnum), unit/suffix (`text-sm` muted), delta chip (arrow icon + "+12% vs prev 30d", coloured by *good/bad*, not up/down), sparkline (height 32 px, full width, 30 points, `--accent` 1.5 px stroke, area at 12 percent, last-point dot 4 px), footer `text-xs` faint "Updated 40 s ago".

**Props:** `label`, `value: string|number`, `unit?`, `delta?: { value: number; goodDirection: 'up'|'down'; label: string }`, `series?: number[]`, `seriesLabel: string`, `status?: 'neutral'|'success'|'warning'|'danger'` (adds 3 px left border), `href?`, `loading?`, `error?`.
**States:** default, hover/focus (only if `href`: border `--border-bright`, focus ring), loading (value + sparkline skeleton, keep size to prevent layout shift), empty (value "-" with "No data in range"), error (inline "Couldn't load" + Retry).
**A11y:** the sparkline is decorative-plus-text: `role="img"` with `aria-label="Deploy frequency, last 30 days: min 0, max 6, latest 4"`, or `aria-hidden` with a visually hidden table link. Delta text always spells direction ("up 12 percent"); colour is secondary. Tile is a `<section aria-labelledby>`; if clickable, the label is the link. Tile value changes are not live-announced.

### 8.3 Env health dot

Environment liveness shown in the top bar, board column headers and Health page.

**Anatomy:** 10 px dot (`--ok|--warn|--bad|--neutral` solid) with 2 px ring of the same colour at 25 percent; optional label (`text-xs`, env name) and tooltip with detail. Shape differs by state so it survives monochrome: healthy = filled circle, degraded = half-filled/diamond, down = filled square with cross, unknown = hollow circle.

**Props:** `env: string`, `state: 'healthy'|'degraded'|'down'|'unknown'|'deploying'`, `lastChecked?: Date`, `lastDeploy?: string`, `showLabel?: boolean`, `href?`.
**States:** `deploying` pulses (reduced motion: static + ring). Hover/focus reveals tooltip (also on keyboard focus, `Esc` dismisses, remains hoverable per SC 1.4.13). Stale (> 5 min since check) turns to `unknown` and tooltip says "Last checked 7 min ago".
**A11y:** `role="img"` is wrong when interactive; instead render `<a>`/`<button>` with `aria-label="QA: healthy, checked 40 seconds ago"`. Non-interactive: `<span role="img" aria-label=...>`. A group of dots in the top bar is a `role="list"` with an `aria-label="Environment health"`.

### 8.4 Version chip

Compact display of a FE/BE build: `BE v2.41.0`, branch or SHA.

**Anatomy:** `[kind prefix: FE|BE][version]` in `--font-code`, `text-xs`, `--r-xs`, `--panel-2` fill, 1 px `--border`, padding 2 x 6; prefix in `--muted`, version in `--text`. Optional trailing copy icon on hover/focus; optional "ahead N" suffix badge in warn when the env lags.

**Props:** `kind: 'FE'|'BE'`, `version: string`, `sha?: string`, `href?` (release or PR), `copyable?: boolean` (default true), `tone?: 'default'|'drift'|'hotfix'`.
**States:** default, hover (border bright, copy icon visible), focus (ring), copied (icon swaps to check for 1.5 s, toast not needed; polite live text "Copied"), drift/hotfix (border and prefix use warn / info text).
**A11y:** if interactive it is a `<button>` (copy) or `<a>`; accessible name "Backend version 2.41.0, copy" . Long strings truncate in the middle; full value in `title` and as the copied value. Hit target extends to at least 24 px height via padding even in compact.

### 8.5 Journey stepper

Ticket path `Dev - QA - Stage - Pre-Prod - Prod` with timestamps. Used in the drawer (horizontal) and ticket card (mini, dots only).

**Anatomy:** ordered steps; each = node (20 px circle: check = done, filled = current, hollow = pending, x = failed, dash = skipped) + label (`text-xs`) + timestamp (`text-2xs` faint) + connector line (2 px; solid `--ok` when both ends done, dashed `--border-bright` otherwise). Optional link on the node to the deploy run.

**Props:** `steps: { key: string; label: string; state: 'done'|'current'|'pending'|'failed'|'skipped'; at?: string; href?: string; note?: string }[]`, `variant?: 'full'|'mini'`, `orientation?: 'auto'|'horizontal'|'vertical'` (auto: vertical below 480 px).
**States:** each step state above; current has pulse ring only if in-progress; failed shows `--bad` node with x and label "Failed".
**A11y:** `<ol aria-label="Deployment journey">`; each `<li>` text reads "Stage: deployed 8 Oct 14:05" and a visually hidden "(current)" / "(failed)"; the current step has `aria-current="step"`. Mini variant is `aria-hidden` when the same info is in adjacent text, otherwise `role="img"` with a summary ("Reached Stage, 3 of 5"). Links inside are normal tab stops.

### 8.6 Filter chips

Replaces the long filter bar: chips + "More filters".

**Anatomy:** toolbar containing (a) a search input, (b) chip buttons (`--ctl-h`, `--r-sm`, `text-sm`): *unset* chip = outline, label "Env"; *set* chip = `--accent` 12 percent tint fill, label "Env: QA, Stage" with remove x; (c) "More filters" button with count badge opening a popover or bottom sheet; (d) "Clear all" link when any set; (e) saved views menu (optional).

**Props (chip):** `field: string`, `label: string`, `value?: string[]`, `options: {value;label;count?}[]`, `multi?: boolean`, `onChange`, `onRemove`. **Props (bar):** `chips`, `moreFilters`, `resultCount`, `onClearAll`, `syncToUrl: boolean` (default true, so views are shareable).
**States:** default, hover, focus, open (popover; `aria-expanded`), set, disabled, loading options. Role lens may pre-set chips (shown as normal removable chips tagged "from lens").
**A11y:** container `role="toolbar"` + `aria-label="Filters"` with roving tabindex (arrow keys, Home/End). Each chip is a `<button aria-haspopup="listbox" aria-expanded>`; the popover is a listbox or checkbox group, focus moves into it, `Esc` closes and restores focus to the chip, `Enter`/`Space` toggles an option. Remove x is a separate button with `aria-label="Remove filter Env: QA"`. Result count in a polite live region ("42 tickets"). On mobile, the popover becomes a bottom sheet with a focus trap.

### 8.7 Ticket card

One Jira ticket in the Pipeline board, search results and mobile lists.

**Anatomy:** card (`--r-md`, 1 px border, `--panel`): row 1 - key (mono, link-styled `--accent-text`), type icon, priority icon; row 2 - title (`text-sm` 600, 2-line clamp); row 3 - assignee avatar (24 px) + name (hidden in compact), version chips (FE/BE, max 2 + "+n"); row 4 - age-in-stage ("5d in QA", tnum), badge cluster (Hotfix, Rolled back, Stuck 5d, Blocked) as status pills (`sm`); optional mini journey stepper in comfortable density.

**Props:** `ticket: { key; title; type; priority; assignee?; stage; ageDays; versions: {kind;version}[]; flags: ('hotfix'|'rolledBack'|'stuck'|'blocked')[]; journey? }`, `density?`, `selected?`, `onOpen(key)`, `draggable?: false` (read-only board, no drag in v1), `href`.
**States:** default, hover (border bright), focus-visible (ring), selected (drawer open: 2 px `--accent` left border + `--panel-2` fill), loading (skeleton with same height), flagged (left border colour of worst flag, plus the pill).
**A11y:** whole card is one `<article>` containing a single primary `<a href="/tickets/KEY">` on the key/title (stretched via `::after`), so the card has one tab stop; secondary controls (version copy) remain separate. Opening with click, `Enter` or `Space` (on a role-button variant) intercepts to open the drawer and keeps the real URL for new-tab. Accessible name: "PROJ-123, Fix invoice rounding, in QA 5 days, stuck". `j/k` moves between cards.

### 8.8 Ticket drawer

Right-side panel showing one ticket anywhere in the app.

**Anatomy:** `<aside>` width `min(480px, 100vw)` (full-screen sheet < 640), `--panel`, `--elev-2`, leading corners `--r-lg`; scrim `--scrim` behind (click closes). Header (sticky): key + external Jira link, copy-link, prev/next, close x. Body (scrolls): title, status pill + lens-relevant badges, journey stepper (full) with deploy timestamps and run links, linked PRs list, version chips per env, release-note snippet, recent deployments table. Footer (sticky): "Open in Jira", "Copy link".

**Props:** `ticketKey: string | null` (mirrors URL `?t=KEY`), `onClose`, `onNavigate(dir)`, `initialFocus?: 'close'|'title'`, `data`/`loading`/`error` via fetch hook.
**States:** closed, opening (200 ms slide, none if reduced motion), loading (skeleton sections), loaded, empty-section ("No linked PRs"), error ("Couldn't load KEY" + Retry + still show key and Jira link), stale-refresh (silent poll, "Updated 40 s ago").

**Keyboard and focus (normative):**
1. Opening moves focus to the drawer heading (`tabindex="-1"`) or the close button; the opener is remembered.
2. Focus is **trapped** while open: `Tab` from the last focusable wraps to the first, `Shift+Tab` the reverse. Prefer the native `<dialog>` opened with `showModal()` (gives trap, inert background, `Esc`); else mark the app root `inert` and add a sentinel-based trap.
3. `Esc` closes the drawer (unless a nested popover/menu is open - that closes first) and returns focus to the opener element; if the opener is gone (list re-rendered), focus the list container.
4. Scrim click closes; back button closes (drawer state is in the URL; closing replaces history entry rather than adding one).
5. `[` and `]` (or the prev/next buttons) move to the previous/next ticket in the originating list and keep focus on the drawer heading.
6. `Cmd/Ctrl+K` inside the drawer opens the palette above it (palette z 50 > drawer 40); closing the palette returns to the drawer.
7. Body scroll of the page is locked; only the drawer body scrolls. Wheel at the end does not chain.
8. Screen reader: `role="dialog"` `aria-modal="true"` `aria-labelledby` (heading); announce "Ticket PROJ-123 opened" via the dialog name, not an extra live region.

### 8.9 Role-lens switcher

Changes the home page and default filters, not permissions.

**Anatomy:** in the top bar a segmented control / select showing the active lens (icon + label: Developer, QA, Release / DevOps, Management). Desktop: button with popover menu listing lenses with a one-line description each. Mobile: appears in the account sheet and as a chip on Home. Active lens also reflected as `?as=qa` and stored in `localStorage` (`tracker-lens`).

**Props:** `value: 'dev'|'qa'|'release'|'mgmt'`, `onChange`, `lenses: { id; label; description; icon }[]`, `variant?: 'menu'|'segmented'`.
**States:** default, open, hover, focus, selected (check mark + `aria-checked`), pending-load (home skeleton). Changing the lens shows a polite toast "Lens: QA - filters reset" with Undo (see 8.12) when filters were changed.
**A11y:** implement as a menu button (`aria-haspopup="menu"`, items `role="menuitemradio"` with `aria-checked`) or, for <= 4 options inline, `role="radiogroup"` with roving tabindex and arrow keys. Typeahead on the first letter. Label "Role lens". Shortcut: `g l` opens it (optional). Focus returns to the button on close.

### 8.10 App shell and navigation

**Anatomy (desktop >= 1024):** skip link ("Skip to content", first tab stop) - top bar (52 px: logo, role-lens switcher, search trigger showing `Cmd K` hint, env health dots, theme toggle, density, account) - left sidebar (232 px; collapsible to 64 px icon rail with tooltips; items: Home, Pipeline, Tickets, Releases, Insights, Health, and Settings for admins; active item = 3 px `--accent` leading bar + `--panel-2` fill + `aria-current="page"`) - main (`<main id="content">`, max-width 1600).

**Anatomy (mobile < 640):** slim top bar (logo, search icon button, lens chip, account) and a fixed **bottom tab bar** (56 px + safe-area): 5 tabs max - Home, Pipeline, Tickets, Releases, More (opens a sheet with Insights, Health, Settings, theme, density). Each tab: 24 px icon + `text-2xs` label, min 44 x 44, active = `--accent-text` + filled icon + `aria-current="page"`.

**Props:** `navItems: { id; label; href; icon; adminOnly?; badge?: number }[]`, `lens`, `envHealth`, `isAdmin`, `collapsed?` (persisted `tracker-nav`), `children`.
**States:** item default / hover (`--panel-2`) / focus / active / disabled (admin items hidden, not disabled, for viewers); collapsed rail (label becomes tooltip + `aria-label`); badge (count of failed deploys, `--bad`, with visually hidden "failed deploys").
**A11y:** landmarks: `<header>`, `<nav aria-label="Primary">` (the same list is reused for the tab bar, rendered once per breakpoint, not both), `<main>`. Skip link targets `#content`; route change moves focus to the page `<h1>` and updates `document.title`. Tab bar is `<nav aria-label="Primary">`; "More" is a `<button aria-haspopup="dialog">`. Respect safe areas. Search trigger is a real button `aria-keyshortcuts="Control+K Meta+K"`.

**Command palette (Cmd/Ctrl+K):** modal `<dialog>`, width 560, input (combobox, `role="combobox" aria-expanded aria-controls aria-activedescendant`) over a listbox grouped Tickets, Versions, Branches, Deployers, Pages, Actions. `Up/Down` moves, `Enter` opens the ticket drawer or deployment row, `Cmd+Enter` opens in a new tab, `Esc` closes (always closes; `Cmd+Backspace` clears the query). Results announce "6 results" in a polite region. Focus is trapped; on close it returns to the previously focused element. Debounce 120 ms; recent searches shown when empty.

### 8.11 Skeleton, empty and error states

Every panel (tile, table, board column, drawer section, chart) implements **all four** data states through one wrapper, `<AsyncPanel state>`, so none is forgotten.

| State | Visual | Behaviour | A11y |
|-------|--------|-----------|------|
| Loading | `.skeleton` blocks with the *final* dimensions (no layout shift), 1.4 s shimmer; static fill under reduced motion; show only after 200 ms to avoid flash | keep previous data visible during background refresh (no skeleton), show small "Refreshing" text | container `aria-busy="true"`; one `role="status"` "Loading tickets" (visually hidden) per page, not per block |
| Empty | icon (32 px, `--faint`), title (`text-md`), one sentence of why + what to do, optional primary action | distinguish "no data yet" vs "no results for filters" (latter offers "Clear filters") | heading level fits page outline; action is a button/link |
| Error | `--bad-bg` inline panel, `x-circle`, "Couldn't load deployments", cause hint (HTTP status, "Jira unreachable"), **Retry** button, "Show details" disclosure with request id | keep stale data below with a "Showing data from 10:12" banner when available; retry with backoff; 90 s poll continues | `role="alert"` on first appearance only; retry button focus is not stolen |
| Partial | warn banner "Jira data delayed - deployment data is current" | panels degrade independently | `role="status"` |

**Props:** `state: 'loading'|'empty'|'error'|'ready'`, `skeleton: ReactNode` (matching layout), `empty?: { icon; title; description; action? }`, `error?: { message; status?; requestId?; onRetry }`, `staleSince?: Date`, `children`.

### 8.12 Toast

Transient confirmation or non-blocking error (copied link, lens changed, refresh failed, admin action done).

**Anatomy:** card (`--panel`, `--elev-2`, `--r-md`, 1 px `--x-border` plus 3 px left status bar), `[status icon][message text-sm][optional action][close x]`. Stack bottom-right on desktop (above nothing), bottom-centre above the tab bar on mobile (offset `--tabbar-h` + safe area), max 3 visible, newest at bottom, gap 8.

**Props:** `tone: 'success'|'info'|'warning'|'danger'`, `message: string`, `action?: { label; onAction }`, `duration?: number` (default 5000; **errors and toasts with an action do not auto-dismiss**, minimum 8000 if they do), `id?` (dedupe), `onClose`.
**States:** enter (200 ms slide + fade), visible (timer pauses on hover and on focus within; resumes after), exit, persistent.
**A11y:** a single region `<div role="region" aria-label="Notifications">` containing items; success/info items are `role="status"` (polite), danger/warning `role="alert"` (assertive). Toasts never carry the only copy of critical information (failed deploy is also shown in the page). Close button `aria-label="Dismiss notification"`; action is a normal button reachable by `F6` (jump to notifications region) or `Tab`; `Esc` while focus is inside dismisses it. Reduced motion: no slide, fade only.

## 9. Accessibility checklist (applies to every component)

- WCAG 2.2 AA: contrast per section 2.2; focus visible (2 px `--focus-ring`, 2 px offset, never removed); target size at least 24 px (44 on touch); no keyboard traps except intentional modal traps with `Esc`; `prefers-reduced-motion`; forced-colors support (borders on pills/chips so they keep a boundary; status icons carry meaning).
- Status never colour alone (icon + label; health dot shape differs).
- 90 s polling updates data in place without moving focus or scroll; changes that matter are announced through one polite live region ("2 deployments updated"), not per-cell.
- Every page has one `<h1>`, landmarks, a skip link, and a title updated on navigation.

## 10. Implementation notes

1. `app/globals.css`: after `@import "tailwindcss";` add `@import "../docs/redesign/tokens.css";` (move the file to `app/tokens.css` at build time). Keep the legacy variable names; delete `.wrap.dark/.light` class theming once pages migrate.
2. Pre-paint theme script in `layout.tsx` `<head>`: read `tracker-theme`, `tracker-density` in try/catch, set `data-theme`/`data-density` on `<html>` (add `suppressHydrationWarning` on `<html>`).
3. Build primitives first (Pill, Chip, Dot, Tile, Skeleton, Toast, Drawer, Shell), then screens; add a `/dev/design` kitchen-sink page and a token-contrast unit test.
4. Open items for the owner: default theme when nothing is stored (dark today vs OS); keep Montserrat or move to system stack; whether `Cmd+K` is also exposed as a visible search field in the top bar on mobile (proposed: yes, icon button).
