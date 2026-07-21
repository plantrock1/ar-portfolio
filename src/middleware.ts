import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Release-mode deployments (SITE_MODE=releases, currently just Lexi's site)
// serve the release-timeline pages instead of the streaming-analytics ones.
// The release routes live under /releases/* so both "apps" can coexist in
// the same codebase; this middleware rewrites URLs so visitors typing e.g.
// lexi.vercel.app/ actually see /releases without any visible URL change.
//
// Only the public-facing pages get rewritten — /admin and /api stay on
// their canonical paths, since admin management + APIs are shared across
// both modes. Existing 5 deployments have no SITE_MODE set and pass
// through unchanged.
export function middleware(req: NextRequest) {
  if (process.env.SITE_MODE !== "releases") return NextResponse.next();

  const { pathname } = req.nextUrl;

  // Already on the /releases tree — nothing to do.
  if (pathname.startsWith("/releases")) return NextResponse.next();

  // Root and /artist/* are the two public routes we rewrite. Everything
  // else (admin, API, static, favicon, etc.) passes straight through.
  if (pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/releases";
    return NextResponse.rewrite(url);
  }
  if (pathname.startsWith("/artist/")) {
    const url = req.nextUrl.clone();
    url.pathname = `/releases${pathname}`;
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/artist/:path*"],
};
