import { SignJWT, jwtVerify } from "jose";

/** Edge-safe JWT helpers (used by proxy.ts and the server). */
export const SESSION_COOKIE = "aas_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export type SessionClaims = { sub: string; ws: string; sv: number };

function secretKey(secret: string) {
  return new TextEncoder().encode(secret);
}

export async function signSession(claims: SessionClaims, secret: string): Promise<string> {
  return new SignJWT({ ws: claims.ws, sv: claims.sv })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .setIssuer("ai-affiliate-studio")
    .sign(secretKey(secret));
}

export async function verifySession(token: string, secret: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), { issuer: "ai-affiliate-studio" });
    if (typeof payload.sub !== "string" || typeof payload.ws !== "string") return null;
    return { sub: payload.sub, ws: payload.ws, sv: Number(payload.sv ?? 1) };
  } catch {
    return null;
  }
}
