# Mobile Studio (collapsible rails) Implementation Plan

> **For agentic workers:** This repo's `CLAUDE.md` Token-Efficient Agent Delegation Policy
> overrides the default subagent-driven handoff. Execute this plan **inline in the primary
> session, 0 subagents.** Live verification needs a persistent dev server, which subagents
> cannot hold. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/studio` compose and review usable on a phone by collapsing the left rail
into a drawer and the inspector into a bottom sheet, with the desktop layout unchanged.

**Architecture:** Purely a layout change. The `composing → listing → transitioning →
reviewing` state machine, `selection`, the render queue, Server Actions, metering, and
persistence are all untouched. The three-column desktop shell re-gates from `md` to `lg`;
below `lg` a new `MobileBar` hosts the same `RailContent` and the same single `Inspector`
inside Base UI sheets.

**Tech Stack:** Next.js 16 App Router · React 19 · Tailwind CSS · shadcn `base-rhea` style
on `@base-ui/react` · Motion (`motion/react`) · Playwright (via `npx`) for verification.

## Global Constraints

- **Breakpoint is `lg` (1024px), never `md`.** Fixed review chrome is 640px; `md` (768px)
  leaves the canvas 128px. Copied from spec D1.
- **Desktop (≥1024px) must be visually identical to today.** Every mobile rule is additive
  and gated; no unconditional restyling of existing elements.
- **Exactly one `Inspector` mounts at any width** (spec D5). It holds local draft state
  (`AvoidField.draft`, `ConnectionInspector.direction`); `hidden` still mounts, so the
  desktop column must be conditionally *rendered*, not hidden.
- **Both inspector roots carry `w-72 shrink-0`** — `inspector.tsx:126` (moment) and
  `inspector.tsx:408` (`ConnectionInspector`). Fixing one and not the other ships a bug
  where moments look right and joints stay crushed.
- **Primitives come from `@base-ui/react` only.** `components.json` style is `base-rhea`.
  Never introduce a Radix-based component. (Verified: `sheet` exists in this registry and
  imports `Dialog` from `@base-ui/react/dialog`.)
- **No new test framework.** `vitest.config.ts` is `environment: 'node'`, pure-function
  tests only, deliberately without jsdom to avoid a React 19 peer-dep conflict. Do not add
  jsdom or testing-library. Layout is verified with Playwright against a real dev server.
- **Nothing in this plan may touch** money, auth logic, generation, or persistence code.
  `AuthButton`/`BuyTokens` are *relocated in JSX*, never modified.
- Verify with `npm run build`, `npm run lint`, `npx vitest run` before committing.

---

### Task 1: Foundation — `sheet` primitive and `useIsDesktop`

**Files:**
- Create: `miru/src/components/ui/sheet.tsx` (via CLI)
- Create: `miru/src/lib/use-is-desktop.ts`

**Interfaces:**
- Produces: `Sheet`, `SheetTrigger`, `SheetContent`, `SheetHeader`, `SheetTitle`,
  `SheetDescription` from `@/components/ui/sheet`. `SheetContent` takes
  `side?: 'top' | 'right' | 'bottom' | 'left'`.
- Produces: `useIsDesktop(): boolean` from `@/lib/use-is-desktop` — `true` at ≥1024px.

- [ ] **Step 1: Install the sheet primitive**

```bash
cd miru && npx shadcn@latest add sheet
```

- [ ] **Step 2: Verify it uses Base UI, not Radix**

```bash
head -5 miru/src/components/ui/sheet.tsx
```

Expected: `import { Dialog as SheetPrimitive } from "@base-ui/react/dialog"`.
If it shows `@radix-ui/*`, stop — delete the file and compose the drawer from the existing
`components/ui/dialog.tsx` instead.

- [ ] **Step 3: Write `useIsDesktop`**

`getServerSnapshot` returns `true` so SSR matches the desktop-first markup; a phone paints
the desktop column for one frame and swaps on hydration.

```typescript
'use client'

import { useSyncExternalStore } from 'react'

// Single source of truth for the lg breakpoint (1024px), matching Tailwind's `lg:`.
// Layout gating only — used to mount the Inspector in exactly one place, since it holds
// local draft state and a hidden duplicate would resurface stale values on resize.
const QUERY = '(min-width: 1024px)'

function subscribe(onChange: () => void) {
  const list = window.matchMedia(QUERY)
  list.addEventListener('change', onChange)
  return () => list.removeEventListener('change', onChange)
}

export function useIsDesktop() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => true
  )
}
```

- [ ] **Step 4: Typecheck**

```bash
cd miru && npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add miru/src/components/ui/sheet.tsx miru/src/lib/use-is-desktop.ts miru/package.json miru/package-lock.json
git commit -m "feat(mobile): add sheet primitive and useIsDesktop breakpoint hook"
```

---

### Task 2: Extract `RailContent` from `LeftRail`

The rail is the only mount point for `AuthButton` (which owns the balance and
`BuyTokens`), `SceneLibrary`, the PROJECT nav, and EXPORTS. Splitting it is what lets the
drawer show the same thing without duplicating it.

**Files:**
- Modify: `miru/src/components/left-rail.tsx`

**Interfaces:**
- Produces: `RailContent` — same props as `LeftRail` plus `onNavigate?: () => void`.
- Produces: `LeftRail` — unchanged public props; now just the desktop `<aside>` wrapper.

- [ ] **Step 1: Split the component**

`RailContent` is layout-neutral: no width, no border, no `hidden`/`flex` gating, no
`h-svh`. `onNavigate` fires after every navigating action so the drawer can close.
Export buttons deliberately do **not** call it — export progress (`Recording… 42%`) and
error text render inside the rail, and closing would hide them.

Rail entries get a taller touch row that collapses back at `lg`:

```typescript
const ENTRY = 'flex w-full items-center gap-2 py-2.5 text-left text-[13px] text-[var(--muted-foreground)] transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40 lg:py-1.5'
```

Restructure to:

```typescript
export function RailContent({
  project, mode, hasFrames, onShowAnimatic, onEnterReview, onBackToCompose,
  activeRowId, onOpenScene, onNewScene, generating, onNavigate,
}: LeftRailProps & { onNavigate?: () => void }) {
  // ...existing useState/runExport body, unchanged...
  return (
    <>
      <p className="text-[13px] font-medium tracking-[0.24em] text-foreground">SCENELAB</p>
      <AuthButton />
      <SceneLibrary
        activeRowId={activeRowId}
        onOpen={(rowId) => { onOpenScene(rowId); onNavigate?.() }}
        onNew={() => { onNewScene(); onNavigate?.() }}
        busy={generating}
      />
      {/* ...PROJECT nav and EXPORTS exactly as today, with onNavigate?.() added to
          Compose / Storyboard / Animatic handlers only... */}
    </>
  )
}

export function LeftRail(props: LeftRailProps) {
  return (
    <aside className="sticky top-0 hidden h-svh w-[248px] shrink-0 flex-col gap-8 overflow-y-auto border-r border-white/10 px-5 py-6 lg:flex">
      <RailContent {...props} />
    </aside>
  )
}
```

Note `md:flex` → `lg:flex` and the added `overflow-y-auto` (the rail can now exceed the
viewport at short heights once EXPORTS expands).

- [ ] **Step 2: Verify desktop is unchanged**

```bash
cd miru && npm run build && npm run lint
```

Expected: both pass. At ≥1024px the rail renders identically — same children, same order.

- [ ] **Step 3: Commit**

```bash
git add miru/src/components/left-rail.tsx
git commit -m "refactor(rail): split RailContent from the desktop aside shell"
```

---

### Task 3: Un-crush the Inspector

**Files:**
- Modify: `miru/src/components/inspector.tsx:126` and `:408`

- [ ] **Step 1: Fix both roots**

Both currently read `flex w-72 shrink-0 flex-col gap-5`. Both become:

```
flex w-full flex-col gap-5 lg:w-72 lg:shrink-0
```

Line 126 is the moment inspector; line 408 is `ConnectionInspector`. Confirm two
occurrences changed:

```bash
grep -n "lg:w-72" miru/src/components/inspector.tsx
```

Expected: exactly 2 lines.

- [ ] **Step 2: Build**

```bash
cd miru && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add miru/src/components/inspector.tsx
git commit -m "fix(inspector): let both inspector roots fill their container below lg"
```

---

### Task 4: `MobileBar` — drawer and bottom sheet

**Files:**
- Create: `miru/src/components/mobile-bar.tsx`

**Interfaces:**
- Consumes: `RailContent` (Task 2), `Sheet`/`SheetContent`/`SheetTitle` (Task 1).
- Produces: `MobileBar` — takes the same rail props, plus `showDetails: boolean` and
  `inspector: React.ReactNode`.

The bar owns its own open/closed state; the studio page passes data and nodes, not sheet
state. `inspector` is passed as a node so the page decides which single `Inspector`
instance exists (Task 5), keeping spec D5 in one place.

- [ ] **Step 1: Write the component**

```typescript
'use client'

import { useState } from 'react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { RailContent } from '@/components/left-rail'
import type { Project } from '@/types'

interface MobileBarProps {
  project: Project
  mode: 'compose' | 'review'
  hasFrames: boolean
  onShowAnimatic: () => void
  onEnterReview: () => void
  onBackToCompose: () => void
  activeRowId: string | null
  onOpenScene: (rowId: string) => void
  onNewScene: () => void
  generating: boolean
  // Review only — the Details trigger is pointless in compose.
  showDetails: boolean
  // The single Inspector instance, owned by the page (spec D5).
  inspector: React.ReactNode
}

export function MobileBar({ showDetails, inspector, ...rail }: MobileBarProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-2.5 lg:hidden">
      <button
        type="button"
        onClick={() => setMenuOpen(true)}
        aria-label="Open menu"
        aria-expanded={menuOpen}
        className="text-[15px] leading-none text-[var(--muted-foreground)] transition-colors hover:text-foreground"
      >
        ☰
      </button>
      <p className="min-w-0 flex-1 truncate text-[13px] font-medium tracking-[0.18em] text-foreground">
        SCENELAB
      </p>
      {showDetails ? (
        <button
          type="button"
          onClick={() => setDetailsOpen(true)}
          aria-label="Open shot details"
          aria-expanded={detailsOpen}
          className="text-[12px] text-[var(--muted-foreground)] transition-colors hover:text-foreground"
        >
          Details
        </button>
      ) : null}

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="flex w-[280px] flex-col gap-8 overflow-y-auto px-5 py-6">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <RailContent {...rail} onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>

      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetContent side="bottom" className="max-h-[85svh] overflow-y-auto px-5 pt-4 pb-8">
          <SheetTitle className="sr-only">Shot details</SheetTitle>
          {inspector}
        </SheetContent>
      </Sheet>
    </div>
  )
}
```

- [ ] **Step 2: Reconcile with the installed `sheet.tsx` API**

Read `miru/src/components/ui/sheet.tsx` and adjust: the shadcn sheet may already apply
side-positioning classes, a close button, and its own padding, in which case drop the
duplicated `px`/`py` above. If `SheetContent` does not accept `side`, use the variant name
the installed file exposes.

- [ ] **Step 3: Build**

```bash
cd miru && npm run build && npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add miru/src/components/mobile-bar.tsx
git commit -m "feat(mobile): add MobileBar with rail drawer and inspector sheet"
```

---

### Task 5: Wire the studio page

**Files:**
- Modify: `miru/src/app/studio/page.tsx`

- [ ] **Step 1: Hoist the single `Inspector` and mount `MobileBar`**

Extract the existing `<Inspector … />` JSX (currently at `page.tsx:1644`, with all ~20
props) into a local `const inspectorNode = <Inspector … />` computed once in the review
branch. Then:

- Desktop column (`page.tsx:1638`): render the wrapper **only** when `isDesktop`, with
  `inspectorNode` inside. Not `hidden lg:block` — see Global Constraints.
- `MobileBar`: rendered once as the first child of the outer flex, receiving
  `inspector={isDesktop ? null : inspectorNode}` so exactly one instance exists.

Outer wrapper becomes a column that stacks the bar above the row:

```
<div className="flex min-h-svh w-full flex-col lg:flex-row">
```

- [ ] **Step 2: Apply the responsive classes**

| Line | Element | Change |
|---|---|---|
| 1492 | review wrapper | `flex h-svh min-w-0 overflow-hidden` → `flex min-h-0 flex-1 min-w-0 flex-col overflow-hidden lg:h-svh lg:flex-row` |
| 1497 | center column | `px-8 py-6` → `px-4 py-4 lg:px-8 lg:py-6` |
| 1498 | storyboard toolbar | add `flex-wrap` |
| 1254 | compose column | `px-6 py-16` → `px-4 py-8 lg:px-6 lg:py-16` |
| 1301 | cast row | `flex gap-2` → `flex flex-col gap-2 sm:flex-row`; name `Input` `w-36` → `w-full sm:w-36` |
| 1365 | setting row | `flex gap-2` → `flex flex-col gap-2 sm:flex-row`; name `Input` `w-44` → `w-full sm:w-44` |
| 1232 | demo banner | `fixed` → `static lg:fixed`; inner pill gains `flex-col text-center sm:flex-row` and `max-w-full` |

The toolbar `flex-wrap` matters more than it looks: that row inlines long confirmation
sentences ("Cancel stops the ones that haven't started…") which currently force horizontal
overflow instead of wrapping.

- [ ] **Step 3: Build and lint**

```bash
cd miru && npm run build && npm run lint && npx vitest run
```

- [ ] **Step 4: Commit**

```bash
git add miru/src/app/studio/page.tsx
git commit -m "feat(mobile): stack the studio shell and mount MobileBar below lg"
```

---

### Task 6: Tap targets

**Files:**
- Modify: `miru/src/components/review-strip.tsx:122`

- [ ] **Step 1: Widen the joint button**

`h-24 w-7 shrink-0` → `h-24 w-11 shrink-0 lg:w-7`. 28px is below any reasonable touch
target; the 72px thumbnails are already fine.

- [ ] **Step 2: Build and commit**

```bash
cd miru && npm run build
git add miru/src/components/review-strip.tsx
git commit -m "fix(mobile): widen connection joint tap target below lg"
```

---

### Task 7: Live verification

Repo convention: temporary Playwright script against a real dev server, run in the
**primary session**, then deleted. This is the only meaningful test for layout work given
the node-only vitest setup.

**Files:**
- Create (temporary, deleted in Step 4): a Playwright script in the scratchpad directory.

- [ ] **Step 1: Start the dev server**

```bash
cd miru && npm run dev
```

- [ ] **Step 2: Run the checks at 390×844 and 768×1024**

The script asserts, on the demo project (`/studio?demo=1` or whatever the demo entry is —
confirm from the page's demo detection):

1. No horizontal page scroll: `document.documentElement.scrollWidth <= innerWidth + 1`.
2. The hero canvas bounding box is ≥ 60% of viewport width (today it is ~62px on a 390px
   phone — this assertion fails before Task 5 and passes after).
3. `☰` is visible; tapping it reveals the SCENES list and the EXPORTS section.
4. Tapping `Details` opens a sheet containing the DESCRIPTION label.
5. With the sheet closed, tapping a strip thumbnail does **not** open it (spec D4).
6. Selecting a **joint** then opening Details shows the CONNECTION panel at full width
   (covers the second `w-72` root).
7. At 1280×800, the rail `<aside>` is visible and `☰` is not.

- [ ] **Step 3: Fix anything the script catches, re-run until green**

- [ ] **Step 4: Delete the temp script and stop the dev server**

- [ ] **Step 5: Final gate and commit**

```bash
cd miru && npm run build && npm run lint && npx vitest run
```

Expected: all three pass. Commit any fixes from Step 3.

---

## Manual checks not worth automating

- Signed-in drawer path: balance renders, Buy Tokens opens Stripe Checkout. `AuthButton`
  and `BuyTokens` render in a new parent, so this needs eyes even though no logic moved.
- A PDF export started from the drawer shows progress and does not close the drawer.
- Demo mode: the banner does not overlap the bar, and the sheet inspector is inert.
- Hydration: hard-reload on a phone viewport with cache disabled; the console must show no
  hydration mismatch error from `useIsDesktop` (spec risk).
