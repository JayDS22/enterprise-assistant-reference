import { SignJWT } from "jose";

// Mints a 1-hour tenant-A JWT for the reviewer path. Public endpoint; the
// scope of the issued token is intentionally narrow (tenant A, synthetic data,
// 1-hour expiry) so leaking it does nothing a reviewer couldn't already do by
// clicking around. If this becomes a vector, gate behind a signed invite code
// in the URL query.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return new Response(JSON.stringify({ error: "jwt_secret_not_set" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const token = await new SignJWT({ tenant_id: "A" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(process.env.JWT_ISSUER ?? "enterprise-assistant-reference")
    .setAudience(process.env.JWT_AUDIENCE ?? "assistant.app")
    .setSubject("reviewer-demo")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(secret));

  return new Response(JSON.stringify({ token, tenant_id: "A", user_id: "reviewer-demo" }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
