import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { getDb } from "@/db/client";
import { users, workspaceMembers, workspaces } from "@/db/schema";
import { authSecret, env } from "@/lib/env";
import { can, type Permission, type Role } from "./permissions";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession, verifySession } from "./token";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  workspaceId: string;
  workspaceName: string;
};

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

/** Loads the session user from the cookie and re-validates membership/role against the DB. */
export async function loadSessionFromToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const claims = await verifySession(token, authSecret());
  if (!claims) return null;
  const db = await getDb();
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isActive: users.isActive,
      role: workspaceMembers.role,
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
    })
    .from(users)
    .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(users.id, claims.sub), eq(workspaceMembers.workspaceId, claims.ws)))
    .limit(1);
  const r = rows[0];
  if (!r || !r.isActive) return null;
  return { id: r.id, email: r.email, name: r.name, role: r.role, workspaceId: r.workspaceId, workspaceName: r.workspaceName };
}

export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  return loadSessionFromToken(store.get(SESSION_COOKIE)?.value);
}

/** For server components/pages: redirect to /login when unauthenticated. */
export async function requirePageSession(permission?: Permission): Promise<SessionUser> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (permission && !can(s.role, permission)) redirect("/dashboard?denied=1");
  return s;
}

export async function createSessionCookie(userId: string, workspaceId: string) {
  const token = await signSession({ sub: userId, ws: workspaceId, sv: 1 }, authSecret());
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env().NODE_ENV === "production" && env().APP_URL.startsWith("https://"),
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Validates credentials; returns the user + first workspace membership. */
export async function authenticate(email: string, password: string) {
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
  // Constant-ish time: always run a bcrypt compare.
  const ok = await verifyPassword(password, u?.passwordHash ?? "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva");
  if (!u || !ok || !u.isActive) return null;
  const [m] = await db.select().from(workspaceMembers).where(eq(workspaceMembers.userId, u.id)).limit(1);
  if (!m) return null;
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));
  return { user: u, membership: m };
}
