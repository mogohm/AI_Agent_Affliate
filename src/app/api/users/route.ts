import { z } from "zod";
import { parseJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { ROLES } from "@/lib/auth/permissions";
import { createMember, listMembers } from "@/lib/admin/users";

export const GET = route({ permission: "users:manage" }, async ({ db, session }) => ({ items: await listMembers(db, session.workspaceId) }));

const Body = z.object({
  email: z.string().trim().email().max(200),
  name: z.string().trim().min(1).max(120),
  role: z.enum(ROLES),
  password: z.string().min(10, "รหัสผ่านอย่างน้อย 10 ตัวอักษร").max(200).optional(),
});

export const POST = route({ permission: "users:manage" }, async ({ db, session, req, ip }) => {
  const b = await parseJson(req, Body);
  const r = await createMember(db, session.workspaceId, b);
  await audit(db, { workspaceId: session.workspaceId, userId: session.id, action: "users.create", entityType: "user", entityId: r.user.id, metadata: { email: r.user.email, role: b.role }, ip });
  return r;
});
