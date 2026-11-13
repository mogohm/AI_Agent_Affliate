import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { ensureBootstrap } from "@/lib/bootstrap";
import { authenticate, createSessionCookie } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { errorResponse, parseJson, ApiError } from "@/lib/api";

const Body = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

// naive in-memory throttle per IP+email (sufficient for a single instance; use Redis in multi-instance prod)
const attempts = new Map<string, { n: number; until: number }>();

export async function POST(req: Request) {
  try {
    const db = await getDb();
    await ensureBootstrap(db);
    const body = await parseJson(req, Body);
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    const key = `${ip}|${body.email.toLowerCase()}`;
    const a = attempts.get(key);
    if (a && a.n >= 5 && a.until > Date.now()) throw new ApiError(429, "พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่", "rate_limited");
    const result = await authenticate(body.email, body.password);
    if (!result) {
      attempts.set(key, { n: (a?.n ?? 0) + 1, until: Date.now() + 5 * 60_000 });
      throw new ApiError(401, "อีเมลหรือรหัสผ่านไม่ถูกต้อง", "invalid_credentials");
    }
    attempts.delete(key);
    await createSessionCookie(result.user.id, result.membership.workspaceId);
    await audit(db, { workspaceId: result.membership.workspaceId, userId: result.user.id, action: "auth.login", ip });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
