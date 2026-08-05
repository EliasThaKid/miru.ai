import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'

// Next 16 renamed the `middleware` file convention to `proxy` (Node.js runtime by default).
// This runs on every matched request to keep the Supabase auth session fresh. Note: it is
// NOT an authorization gate — per Next's guidance, each Server Action verifies auth itself
// (see the metering wrapper in Phase 2), never relying on the proxy alone.
export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    // Run on everything except Next internals and static image assets. Auth cookies must
    // still refresh on data/Server-Action routes, so we don't exclude those.
    // The Stripe webhook is excluded: it is a server-to-server POST with no user session,
    // authenticated by signature rather than cookies, and has no business touching them.
    '/((?!_next/static|_next/image|favicon.ico|api/stripe/webhook|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
