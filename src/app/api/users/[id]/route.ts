import { z } from "zod";
import { parseJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { ROLES } from "@/lib/auth/permissions";
import { updateMember } from "@/lib/admin/users";

const Body = z.object({
  role: z.enum(ROLES).optional(),
  isActive: z.boolean().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  resetPassword: z.boolean().optional(),
});

export const PATCH = route<{ id: string }>({ permission: "users:manage" }, async ({ db, session, params, req, ip }) => {
  const b = await parseJson(req, Body);
  const r = await updateMember(db, session.workspaceId, session.id, params.id, b);
  await audit(db, {
    workspaceId: session.workspaceId,
    userId: session.id,
    action: "users.update",
    entityType: "user",
    entityId: params.id,
    metadata: { role: b.role, isActive: b.isActive, name: b.name, passwordReset: !!b.resetPassword },
    ip,
  });
  return { ok: true, temporaryPassword: r.temporaryPassword };
});
