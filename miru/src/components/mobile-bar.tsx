'use client'

import { useState } from 'react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { RailContent, type LeftRailProps } from '@/components/left-rail'

interface MobileBarProps extends LeftRailProps {
  // Review only — there is nothing to inspect in compose.
  showDetails: boolean
  // The single Inspector instance, owned by the page. Passed as a node rather than built
  // here so that exactly one Inspector exists at any width: it holds local draft state, and
  // a second mounted copy would resurface stale drafts on resize.
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
        className="-m-2 p-2 text-[15px] leading-none text-[var(--muted-foreground)] transition-colors hover:text-foreground"
      >
        ☰
      </button>
      <p className="min-w-0 flex-1 truncate text-[13px] font-medium tracking-[0.24em] text-foreground">
        SCENELAB
      </p>
      {showDetails ? (
        <button
          type="button"
          onClick={() => setDetailsOpen(true)}
          aria-label="Open shot details"
          aria-expanded={detailsOpen}
          className="-m-2 p-2 text-[12px] text-[var(--muted-foreground)] transition-colors hover:text-foreground"
        >
          Details
        </button>
      ) : null}

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent
          side="left"
          className="gap-8 overflow-y-auto px-5 py-6 motion-reduce:transition-none"
        >
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <RailContent {...rail} onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>

      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        {/* pt-12 clears the sheet's own absolute close button, which would otherwise land on
            the SHOT block's ◀ ▶ reorder buttons. */}
        <SheetContent
          side="bottom"
          className="max-h-[85svh] overflow-y-auto px-5 pt-12 pb-8 motion-reduce:transition-none"
        >
          <SheetTitle className="sr-only">Shot details</SheetTitle>
          {inspector}
        </SheetContent>
      </Sheet>
    </div>
  )
}
