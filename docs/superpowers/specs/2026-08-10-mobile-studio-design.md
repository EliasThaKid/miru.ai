# Mobile Studio (collapsible rails) — Design

## Context

`/studio` is desktop-only in practice. The review shell is a rigid three-column flex in
`app/studio/page.tsx` — `LeftRail` (248px) · center workspace · `Inspector` (288px) — and
none of the three columns yield below their natural width.

Source of truth for the app's locked conventions is `miru/CLAUDE.md`. This spec covers only
the responsive layer; it does not relitigate the two-mode state machine, the render queue,
persistence, or any money path — none of them change.

## The two problems

**1. The rail is the sole mount point for everything that isn't the canvas.**
`components/left-rail.tsx:62` is `hidden md:flex`. It is the only place `AuthButton`
(which itself owns the balance and `BuyTokens`), `SceneLibrary`, the Compose/Storyboard/
Animatic nav, and the EXPORTS block are rendered. Below 768px they do not exist. A phone
user cannot sign in, see their balance, buy tokens, switch scenes, return to compose, or
export. This is a dead app on mobile, not a cramped one — and it is the more important of
the two problems.

**2. The inspector never shrinks.** `components/inspector.tsx:126` is `w-72 shrink-0`
inside a wrapper that is also `shrink-0` with `px-5`. That is 328px of hard-committed
width. The review wrapper is `h-svh overflow-hidden`, so on a 390px phone the center
column is crushed to ~62px rather than scrolled.

## Goal

Make compose and review usable on a phone, using collapsible rails. UX polish is
explicitly not the bar; reachability and a non-crushed canvas are.

## Non-goals

- The landing page, `/sign-in`, `/sign-up`, and `/legal/*` (scoped out; they are simpler
  pages and can be a separate pass).
- Any change to the state machine, `selection`, the render queue, Server Actions, metering,
  or persistence.
- Touch-specific gestures (swipe-to-dismiss beyond whatever the sheet primitive gives for
  free, drag-reorder, pinch-zoom).
- A mobile-specific information architecture. Mobile shows the same content as desktop,
  relocated — never a reduced feature set.

## Decisions

### D1. The desktop three-column layout requires `lg`, not `md`

Fixed chrome in review is rail `248` + inspector `288` + horizontal padding `104` =
**640px before the canvas gets a single pixel.** At the current `md` breakpoint (768px)
the canvas would receive 128px, which is still broken. The three-column layout therefore
gates at **`lg` (1024px)**, leaving ~384px for a 9:16 hero. Everything ≤1023px gets the
mobile shell.

Consequence to accept deliberately: desktop browser windows 768–1023px wide change
appearance. They are broken today, so this is a fix, but it is a visible change beyond
phones.

### D2. Rails become sheets; the desktop markup is untouched

Mobile gets a slim top bar. `☰` opens `RailContent` in a left drawer. In review mode, a
`Details` button opens `Inspector` in a bottom sheet. The canvas and thumbnail strip own
the full width between them.

Rejected alternatives:
- *One long vertical scroll* (inspector inline under the strip): smallest diff, but the
  left rail still needs a home, and you scroll away from the strip to edit — the
  select-then-edit loop is the core interaction.
- *Bottom tab bar* (Canvas/Shots/Details/Menu): most native-feeling, but hides the strip
  from the canvas, making every selection a two-tap round trip.

### D3. The drawer and the desktop rail render the same component

`LeftRail` currently *is* its `<aside>`. Split it:

- `RailContent` — the inner sections (brand, `AuthButton`, `SceneLibrary`, PROJECT nav,
  EXPORTS). Layout-neutral: no width, no border, no `hidden`/`flex` gating, no `h-svh`.
- `LeftRail` — keeps the `<aside className="... hidden lg:flex">` wrapper and renders
  `RailContent`.
- The mobile drawer renders the same `RailContent`.

One source of truth. A future rail entry appears in both places or neither, which is what
prevents problem #1 from recurring.

`RailContent` gains `onNavigate?: () => void`, called after Compose / Storyboard /
Animatic / open-scene / new-scene. The drawer passes its close function; the desktop
`LeftRail` passes nothing. Export buttons do **not** call it — an export is a long
operation whose progress and error text render inside the rail, and closing the drawer
would hide `Recording… 42%` and any failure message.

### D4. Selection never opens the sheet

Tapping a thumbnail changes `selection` and the open sheet updates live, because it reads
the same state. It does **not** auto-open a closed sheet — browsing the strip must not be
hijacked by a panel. `Details` is the only thing that opens it.

### D5. Exactly one `Inspector` is mounted at any width

`Inspector` holds local draft state — `AvoidField`'s `draft` (`inspector.tsx:380`) and
`ConnectionInspector`'s `direction` (`inspector.tsx:405`). Gating the desktop column with
`hidden lg:block` still *mounts* it, so below `lg` there would be two instances with
independent drafts: edit in the sheet, resize past 1024px, and the desktop panel shows a
stale value it never committed.

So the desktop column is rendered **conditionally**, not hidden. A small
`useIsDesktop()` hook backed by `useSyncExternalStore` over
`matchMedia('(min-width: 1024px)')` — with a `getServerSnapshot` returning `true` so SSR
matches the desktop-first markup — decides which of the two slots receives the single
`Inspector`.

### D6. The drawer primitive must come from Base UI

`components.json` sets style `base-rhea`, and `components/ui/dialog.tsx` imports from
`@base-ui/react/dialog`. `@base-ui/react` is the only primitive dependency in
`package.json`. Try `npx shadcn@latest add sheet` first, per the repo's "never hand-roll
what shadcn provides" rule. **If the `base-rhea` registry does not carry `sheet`, compose
the drawer from the installed `dialog.tsx` rather than pulling a Radix-based sheet** —
introducing a second primitive library for one panel is the worse outcome. Both drawer and
bottom sheet are the same primitive with different side-anchoring.

## Components

### New: `components/mobile-bar.tsx` (`lg:hidden`)

Owns the mobile chrome and its own open/closed state — the studio page passes data and
callbacks, not sheet state.

- `☰` → left drawer, `RailContent`, closes on navigate.
- Scene title (truncated).
- `Details` → bottom sheet with `Inspector`, `max-h-[85svh] overflow-y-auto`. Rendered in
  review mode only.

Demo mode: the bottom sheet's `Inspector` carries the same `inert` treatment as the
desktop inspector column, so demo mode stays read-only on mobile too.

### Changed: `components/left-rail.tsx`

Split per D3. Behavior at `lg`+ is byte-for-byte identical.

### Changed: `components/inspector.tsx`

**Two** roots carry the hard width, not one:

- `inspector.tsx:126` — the moment inspector.
- `inspector.tsx:408` — `ConnectionInspector`, the joint/connection inspector.

Both `flex w-72 shrink-0 flex-col gap-5` → `flex w-full flex-col gap-5 lg:w-72
lg:shrink-0`. Missing the second one leaves every joint selection crushed on mobile while
moment selections look fine — a bug that is easy to ship and easy to miss.

### New: `useIsDesktop()`

Per D5. `useSyncExternalStore` over `matchMedia('(min-width: 1024px)')`; subscribe to the
list's `change` event; `getServerSnapshot` returns `true`. Lives in `lib/` or a `hooks/`
module alongside existing helpers. Its only job is deciding which slot mounts the single
`Inspector`.

### Unchanged

`hero-canvas.tsx` (`aspect-9/16 max-h-[68svh] mx-auto`) and `animatic-player.tsx`
(`max-w-sm` centered) are already correct once given the width. `scene-library.tsx` is
width-neutral and needs nothing.

## Class-level changes in `app/studio/page.tsx`

| Line | Element | Change |
|---|---|---|
| 1492 | review wrapper | `flex-col lg:flex-row` |
| 1497 | center column | `px-4 py-4 lg:px-8 lg:py-6` |
| 1498 | storyboard toolbar | add `flex-wrap` |
| 1638 | inspector column | rendered only when `useIsDesktop()` (D5) — not `hidden` |
| 1254 | compose column | `px-4 py-8 lg:px-6 lg:py-16` |
| ~1301 | cast rows | `flex-col sm:flex-row`; name `Input` `w-full sm:w-36` |
| (settings rows) | setting rows | same treatment as cast rows |
| 1232 | demo banner | static in-flow below `lg`, `lg:fixed` |

The toolbar `flex-wrap` matters more than it looks: that row inlines long confirmation
sentences ("Cancel stops the ones that haven't started…") which currently force horizontal
overflow rather than wrapping.

The demo banner is `fixed inset-x-0 top-0` today and would overlap the new mobile bar. In
flow below `lg` it pushes the bar down instead; its inner pill also needs `flex-col
text-center sm:flex-row` so the sentence and the "Make your own" link stack.

## Tap targets

`review-strip.tsx:122` — `JointButton` is `h-24 w-7` (28px wide). → `w-11 lg:w-7`. The
72px thumbnails are already fine. Rail entries are `py-1.5` at 13px; inside the drawer they
get `py-2.5 lg:py-1.5` for a ~40px row.

## Accessibility

- The sheet primitive supplies focus trap, restore, and Escape. Both sheets need an
  accessible title (visually hidden is fine for the inspector sheet).
- `☰` and `Details` need `aria-label` and `aria-expanded`.
- Reduced motion: the existing `MotionConfig` handles Motion animations; the sheet's own
  slide must respect `prefers-reduced-motion` (fade instead of slide).

## Verification

Acceptance criteria — at 390×844 and 768×1024:

1. Signed out, `/studio` compose: sign-in is reachable within one tap of the `☰` bar.
2. Signed in, review: balance and Buy Tokens are reachable; the scene library opens,
   lists, and switches scenes; the drawer closes on switch.
3. Review: the hero renders at full column width with a correct 9:16 aspect; the strip
   scrolls horizontally; no horizontal page scroll anywhere.
4. `Details` opens the inspector; description/prompt edits persist; the sheet scrolls to
   the GENERATION block.
5. Selecting a thumbnail with the sheet closed does not open it; with it open, it updates.
6. EXPORTS are reachable and a PDF export completes with progress visible in the drawer.
7. Demo mode: banner does not overlap the bar; the sheet inspector is inert.
8. Selecting a **joint** (not just a moment) on mobile renders the connection inspector at
   full width — covers the second `w-72` root.
9. Editing a draft field in the sheet, then widening past 1024px, shows the committed
   value in the desktop panel — no stale duplicate (D5).
10. At ≥1024px the layout is visually identical to today.

Method — per repo convention, a temporary Playwright script against `npm run dev` run in
the **primary session** (subagents lose the dev server and background-task notifications),
then deleted. Plus `npm run build`, `npm run lint`, `npx vitest run`.

## Risks

- **`sheet` may be absent from the `base-rhea` registry** (D6). Mitigation is specified:
  compose from the installed Base UI `dialog.tsx`.
- **768–1023px desktop windows change appearance** (D1). Accepted; they are broken today.
- **`RailContent` extraction touches the auth/token surface.** No logic moves — it is a
  JSX relocation — but `AuthButton` and `BuyTokens` render in a new parent, so the signed-
  in drawer path needs explicit manual verification (criterion 2), not just a build pass.
- **`useIsDesktop()` is a hydration surface.** `getServerSnapshot: () => true` means a
  phone's first paint renders the desktop column, then swaps on hydration. Acceptable
  (`/studio` is already a client-heavy authed view), but a wrong `getServerSnapshot` is
  a hydration mismatch error, not a cosmetic flash. Verify with JS-throttled reload, not
  just a resize.

## Out of scope, noted for later

- A responsive pass on `/`, `/sign-in`, `/sign-up`, `/legal/*`.
- `app/studio/page.tsx` is 1742 lines; extracting the review shell would make this kind of
  layout work cheaper. `miru/CLAUDE.md` already lists that split as a deferred cleanup.
  Not doing it here — this change should stay a layout change.
