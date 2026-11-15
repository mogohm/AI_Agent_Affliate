import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb, callRoute, type TestCtx } from "../helpers";
import { users } from "@/db/schema";
import { verifyPasswordRaw } from "@/lib/auth/password";
import * as pwRoute from "@/app/api/account/password/route";

let t: TestCtx;
beforeAll(async () => {
  t = await setupTestDb({ demo: false });
});
afterAll(async () => t.close());

const SEED_PW = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe!2026";

describe("self-service password change", () => {
  it("requires auth, the correct current password and a strong new password", async () => {
    expect((await callRoute(t.db, pwRoute.POST, { method: "POST", body: { currentPassword: SEED_PW, newPassword: "NewPassword!2026" }, as: null })).status).toBe(401);
    expect((await callRoute(t.db, pwRoute.POST, { method: "POST", body: { currentPassword: "wrong", newPassword: "NewPassword!2026" }, as: "viewer" })).status).toBe(400);
    expect((await callRoute(t.db, pwRoute.POST, { method: "POST", body: { currentPassword: SEED_PW, newPassword: "short" }, as: "viewer" })).status).toBe(400);
    expect((await callRoute(t.db, pwRoute.POST, { method: "POST", body: { currentPassword: SEED_PW, newPassword: SEED_PW }, as: "viewer" })).status).toBe(400);
  });

  it("any role (even viewer) can change only their own password", async () => {
    const r = await callRoute(t.db, pwRoute.POST, { method: "POST", body: { currentPassword: SEED_PW, newPassword: "ViewerNew!2026x" }, as: "viewer" });
    expect(r.status).toBe(200);
    const [viewer] = await t.db.select().from(users).where(eq(users.email, "viewer@example.com"));
    const [editor] = await t.db.select().from(users).where(eq(users.email, "editor@example.com"));
    expect(await verifyPasswordRaw("ViewerNew!2026x", viewer.passwordHash)).toBe(true);
    expect(await verifyPasswordRaw(SEED_PW, editor.passwordHash)).toBe(true);
  });
});
