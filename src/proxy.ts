import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/token";

/**
 * Optimistic auth check (redirects unauthenticated page requests to /login).
 * Real authorisation (session validity, role/permission) is enforced again in every
 * page (requirePageSession) and API route (route()).
 */
const PUBLIC = ["/login", "/api/auth/login", "/api/health"];

function secret() {
  const s = process.env.AUTH_SECRET;
  return s && s.length >= 32 ? s : "dev-only-insecure-auth-secret-change-me-0123456789";
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const ok = token ? await verifySession(token, secret()) : null;
  if (ok) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ", code: "unauthenticated" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|ttf|woff2?)$).*)"],
};
