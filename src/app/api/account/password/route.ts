import { z } from "zod";
import { parseJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { changeOwnPassword } from "@/lib/admin/users";

const Body = z.object({
  currentPassword: z.string().min(1, "กรุณากรอกรหัสผ่านปัจจุบัน").max(200),
  newPassword: z.string().min(10, "รหัสผ่านใหม่อย่างน้อย 10 ตัวอักษร").max(200),
});

/** Any signed-in user can change their own password (current password required). */
export const POST = route({ permission: "account:self" }, async ({ db, session, req, ip }) => {
  const b = await parseJson(req, Body);
  await changeOwnPassword(db, session.id, b.currentPassword, b.newPassword);
  await audit(db, { workspaceId: session.workspaceId, userId: session.id, action: "account.password_change", entityType: "user", entityId: session.id, ip });
  return { ok: true };
});
