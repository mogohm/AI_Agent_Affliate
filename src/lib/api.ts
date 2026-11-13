import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { getDb, type Db } from "@/db/client";
import { can, type Permission } from "@/lib/auth/permissions";
import { loadSessionFromToken, type SessionUser } from "@/lib/auth/session";
import { SESSION_COOKIE } from "@/lib/auth/token";
import { logger } from "@/lib/logger";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = "Resource") => new ApiError(404, `${what} not found`, "not_found");
export const badRequest = (msg: string, details?: unknown) => new ApiError(400, msg, "bad_request", details);
export const conflict = (msg: string, code = "conflict", details?: unknown) => new ApiError(409, msg, code, details);

export type ApiContext<P> = {
  req: NextRequest;
  session: SessionUser;
  db: Db;
  params: P;
  ip: string | null;
};

type Handler<P> = (ctx: ApiContext<P>) => Promise<unknown>;

/**
 * Wraps a route handler with authentication, RBAC, error mapping and JSON serialisation.
 * Every API route MUST go through this (or explicitly opt out, e.g. /api/auth/login).
 */
export function route<P = Record<string, string>>(opts: { permission: Permission }, fn: Handler<P>) {
  return async (req: NextRequest, ctx: { params: Promise<P> }) => {
    try {
      const session = await loadSessionFromToken(req.cookies.get(SESSION_COOKIE)?.value);
      if (!session) throw new ApiError(401, "กรุณาเข้าสู่ระบบ", "unauthenticated");
      if (!can(session.role, opts.permission)) {
        throw new ApiError(403, "สิทธิ์ของคุณไม่เพียงพอสำหรับการทำรายการนี้", "forbidden", { permission: opts.permission });
      }
      const db = await getDb();
      const params = ctx?.params ? await ctx.params : ({} as P);
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
      const result = await fn({ req, session, db, params, ip });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown) {
  if (err instanceof ApiError) {
    return NextResponse.json({ error: err.message, code: err.code, details: err.details }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: "ข้อมูลไม่ถูกต้อง", code: "validation_error", details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
      { status: 400 },
    );
  }
  logger.error("api.unhandled", { error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
  return NextResponse.json({ error: "เกิดข้อผิดพลาดภายในระบบ", code: "internal_error" }, { status: 500 });
}

export async function parseJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw badRequest("Invalid JSON body");
  }
  return schema.parse(body);
}

export function parseQuery<T>(req: NextRequest, schema: ZodType<T>): T {
  const obj: Record<string, string | string[]> = {};
  req.nextUrl.searchParams.forEach((v, k) => {
    const prev = obj[k];
    if (prev === undefined) obj[k] = v;
    else obj[k] = Array.isArray(prev) ? [...prev, v] : [prev, v];
  });
  return schema.parse(obj);
}
