import crypto from "node:crypto";
import { and, asc, count, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users, workspaceMembers } from "@/db/schema";
import { hashPasswordRaw } from "@/lib/auth/password";
import type { Role } from "@/lib/auth/permissions";
import { ApiError } from "@/lib/api";

export async function listMembers(db: Db, workspaceId: string) {
  return db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isActive: users.isActive,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(users.createdAt));
}

export function generateTempPassword(): string {
  // 14 chars, URL-safe, includes a digit and symbol to satisfy typical policies
  return `${crypto.randomBytes(9).toString("base64url")}#7`;
}

export async function createMember(db: Db, workspaceId: string, input: { email: string; name: string; role: Role; password?: string }) {
  const email = input.email.trim().toLowerCase();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing) throw new ApiError(409, "อีเมลนี้มีผู้ใช้อยู่แล้ว", "email_taken");
  const password = input.password || generateTempPassword();
  const [u] = await db.insert(users).values({ email, name: input.name.trim(), passwordHash: await hashPasswordRaw(password) }).returning();
  await db.insert(workspaceMembers).values({ workspaceId, userId: u.id, role: input.role });
  return { user: { id: u.id, email: u.email, name: u.name, role: input.role, isActive: u.isActive }, temporaryPassword: input.password ? null : password };
}

async function activeAdminCount(db: Db, workspaceId: string) {
  const [r] = await db
    .select({ n: count() })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, "admin"), eq(users.isActive, true)));
  return r?.n ?? 0;
}

/** Update role / active flag / name / password. Protects the last active admin. */
export async function updateMember(
  db: Db,
  workspaceId: string,
  actorId: string,
  userId: string,
  patch: { role?: Role; isActive?: boolean; name?: string; resetPassword?: boolean },
) {
  const [m] = await db
    .select({ role: workspaceMembers.role, isActive: users.isActive })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  if (!m) throw new ApiError(404, "ไม่พบผู้ใช้ใน Workspace นี้", "not_found");
  if (userId === actorId && patch.isActive === false) throw new ApiError(409, "ไม่สามารถปิดการใช้งานบัญชีของตัวเองได้", "self_lockout");
  const losesAdmin = m.role === "admin" && m.isActive && ((patch.role && patch.role !== "admin") || patch.isActive === false);
  if (losesAdmin && (await activeAdminCount(db, workspaceId)) <= 1) {
    throw new ApiError(409, "ต้องมี Admin ที่ใช้งานอยู่อย่างน้อย 1 คน", "last_admin");
  }
  if (patch.role) await db.update(workspaceMembers).set({ role: patch.role }).where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  let temporaryPassword: string | null = null;
  const userSet: Partial<typeof users.$inferInsert> = {};
  if (patch.isActive !== undefined) userSet.isActive = patch.isActive;
  if (patch.name) userSet.name = patch.name.trim();
  if (patch.resetPassword) {
    temporaryPassword = generateTempPassword();
    userSet.passwordHash = await hashPasswordRaw(temporaryPassword);
  }
  if (Object.keys(userSet).length) await db.update(users).set(userSet).where(eq(users.id, userId));
  return { temporaryPassword };
}
