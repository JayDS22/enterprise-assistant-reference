import { NextRequest, NextResponse } from "next/server";
import { verifyJwt } from "@/lib/jwt";

// Middleware per FINAL plan §1. Verifies JWT, extracts tenant context, enforces rate limit.
// Rate limit + cost breaker are stubbed; see app/lib/rate_limit.ts + cost_breaker.ts.

export const config = {
  matcher: ["/(chat)/:path*", "/api/:path*"],
};

export async function middleware(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const ctx = await verifyJwt(auth.slice("Bearer ".length));
    const res = NextResponse.next();
    // Pass tenant context to route handlers via request headers.
    res.headers.set("x-tenant-id", ctx.tenantId);
    res.headers.set("x-user-id", ctx.userId);
    return res;
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_token", detail: (err as Error).message },
      { status: 401 },
    );
  }
}
