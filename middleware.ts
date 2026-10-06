import { NextRequest, NextResponse } from "next/server";
import { verifyJwt } from "@/lib/jwt";

// Middleware per FINAL plan §1. Verifies JWT, extracts tenant context, enforces rate limit.
// Rate limit + cost breaker are stubbed; see app/lib/rate_limit.ts + cost_breaker.ts.

export const config = {
  // Match everything under /api/*. demo-jwt is listed as public below so the
  // matcher stays simple (regex-exclude in Next matcher syntax is finicky).
  matcher: ["/api/:path*"],
};

// Routes under /api/* that MUST NOT require auth. Keep tight; every entry
// here is a public attack surface.
const PUBLIC_API_PATHS = new Set<string>(["/api/demo-jwt"]);

export async function middleware(req: NextRequest) {
  if (PUBLIC_API_PATHS.has(req.nextUrl.pathname)) {
    return NextResponse.next();
  }
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const ctx = await verifyJwt(auth.slice("Bearer ".length));
    // Forward tenant context on the REQUEST side so route handlers can read it
    // from req.headers. Setting on res.headers only exposes it to the client.
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-tenant-id", ctx.tenantId);
    requestHeaders.set("x-user-id", ctx.userId);
    return NextResponse.next({ request: { headers: requestHeaders } });
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_token", detail: (err as Error).message },
      { status: 401 },
    );
  }
}
