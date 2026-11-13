/**
 * Integration-test helpers: a fresh in-memory PostgreSQL (PGlite) with migrations + bootstrap,
 * and a way to call Next.js route handlers as a given seeded user.
 */
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { createDatabase, __setDbForTests, type Db } from "@/db/client";
import { users, workspaceMembers } from "@/db/schema";
import { ensureBootstrap, __resetBootstrapFlag } from "@/lib/bootstrap";
import { resetEnvCache } from "@/lib/env";
import { SESSION_COOKIE, signSession } from "@/lib/auth/token";

export type TestCtx = { db: Db; workspaceId: string; close: () => Promise<void> };

export async function setupTestDb(opts: { demo?: boolean } = {}): Promise<TestCtx> {
  process.env.SEED_DEMO_DATA = opts.demo === false ? "false" : "true";
  resetEnvCache();
  __resetBootstrapFlag();
  const state = createDatabase("pglite://memory");
  __setDbForTests(state);
  const s = await state;
  await ensureBootstrap(s.db);
  const [m] = await s.db.select().from(workspaceMembers).limit(1);
  return {
    db: s.db,
    workspaceId: m.workspaceId,
    close: async () => {
      __setDbForTests(undefined);
      __resetBootstrapFlag();
      await s.close();
    },
  };
}

export type SeedUser = "admin" | "editor" | "approver" | "viewer";

export async function sessionCookie(db: Db, who: SeedUser = "admin"): Promise<string> {
  const email = who === "admin" ? (process.env.SEED_ADMIN_EMAIL ?? "admin@example.com") : `${who}@example.com`;
  const [u] = await db.select().from(users).where(eq(users.email, email));
  const [m] = await db.select().from(workspaceMembers).where(eq(workspaceMembers.userId, u.id));
  const token = await signSession({ sub: u.id, ws: m.workspaceId, sv: 1 }, process.env.AUTH_SECRET!);
  return `${SESSION_COOKIE}=${token}`;
}

type RouteFn<P> = (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>;

/** Invoke a route handler as a user; returns status + parsed JSON. */
export async function callRoute<P = Record<string, string>>(
  db: Db,
  handler: RouteFn<P>,
  opts: { url?: string; method?: string; body?: unknown; params?: P; as?: SeedUser | null; formData?: FormData } = {},
): Promise<{ status: number; json: any; res: Response }> {
  const headers = new Headers();
  if (opts.as !== null) headers.set("cookie", await sessionCookie(db, opts.as ?? "admin"));
  let body: BodyInit | undefined;
  if (opts.formData) body = opts.formData;
  else if (opts.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(opts.body);
  }
  const req = new NextRequest(new URL(opts.url ?? "http://localhost/api/test"), { method: opts.method ?? (body ? "POST" : "GET"), headers, body });
  const res = await handler(req, { params: Promise.resolve((opts.params ?? {}) as P) });
  const text = await res.clone().text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json, res };
}
