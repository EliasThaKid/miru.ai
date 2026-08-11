'use client'

import { useSyncExternalStore } from 'react'

// Single source of truth for the lg breakpoint, matching Tailwind's `lg:`.
//
// This exists for one reason: the Inspector holds local draft state (AvoidField's `draft`,
// ConnectionInspector's `direction`), so it must be mounted in exactly ONE place. Gating the
// desktop column with `hidden lg:block` still mounts it, which would give the mobile sheet and
// the hidden desktop panel independent drafts — edit in the sheet, widen past 1024px, and the
// desktop panel shows a stale value it never committed. So the page picks a slot instead.
const QUERY = '(min-width: 1024px)'

function subscribe(onChange: () => void) {
  const list = window.matchMedia(QUERY)
  list.addEventListener('change', onChange)
  return () => list.removeEventListener('change', onChange)
}

// The server snapshot is `true` so SSR renders the desktop-first markup; a phone paints the
// desktop column for one frame and swaps on hydration.
export function useIsDesktop() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => true
  )
}
