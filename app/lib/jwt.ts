import { jwtVerify } from "jose";

export type AuthContext = {
  tenantId: string;
  userId: string;
  rawToken: string;
};

const secret = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET not set");
  return new TextEncoder().encode(s);
};

export async function verifyJwt(token: string): Promise<AuthContext> {
  const { payload } = await jwtVerify(token, secret(), {
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE,
  });
  const tenantId = payload.tenant_id;
  const userId = payload.sub;
  if (typeof tenantId !== "string" || !tenantId) {
    throw new Error("jwt: missing tenant_id claim");
  }
  if (typeof userId !== "string" || !userId) {
    throw new Error("jwt: missing sub claim");
  }
  return { tenantId, userId, rawToken: token };
}
