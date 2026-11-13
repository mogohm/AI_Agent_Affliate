import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb, callRoute, type TestCtx } from "../helpers";
import { auditLogs, jobs, users, videoProjects, marketplaceOffers } from "@/db/schema";
import { enqueueJob, claimNextJob, failJob } from "@/lib/jobs/queue";
import * as aiRoute from "@/app/api/settings/ai/route";
import * as aiKeyRoute from "@/app/api/settings/ai/key/route";
import * as aiTestRoute from "@/app/api/settings/ai/test/route";
import * as budgetRoute from "@/app/api/settings/budget/route";
import * as scoringRoute from "@/app/api/settings/scoring/route";
import * as videoRoute from "@/app/api/settings/video/route";
import * as usersRoute from "@/app/api/users/route";
import * as userRoute from "@/app/api/users/[id]/route";
import * as auditRoute from "@/app/api/audit-logs/route";
import * as systemRoute from "@/app/api/system/status/route";
import * as jobsRoute from "@/app/api/jobs/route";
import * as jobRoute from "@/app/api/jobs/[id]/route";
import * as jobRetry from "@/app/api/jobs/[id]/retry/route";
import * as jobCancel from "@/app/api/jobs/[id]/cancel/route";
import * as jobSummary from "@/app/api/jobs/summary/route";

let t: TestCtx;
beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(async () => t.close());

const FAKE_KEY = "sk-test-super-secret-value-1234567890ABCD";

describe("settings RBAC & secrets", () => {
  it("viewer/editor cannot change settings, credentials or users", async () => {
    for (const who of ["viewer", "editor"] as const) {
      expect((await callRoute(t.db, aiRoute.PATCH, { method: "PATCH", body: { mode: "demo" }, as: who })).status).toBe(403);
      expect((await callRoute(t.db, aiKeyRoute.PUT, { method: "PUT", body: { apiKey: FAKE_KEY }, as: who })).status).toBe(403);
      expect((await callRoute(t.db, usersRoute.GET, { as: who })).status).toBe(403);
      expect((await callRoute(t.db, budgetRoute.PATCH, { method: "PATCH", body: { dailyUsd: 1, monthlyUsd: 2, perVideoUsd: 1, fxThbPerUsd: 36 }, as: who })).status).toBe(403);
      expect((await callRoute(t.db, auditRoute.GET, { as: who })).status).toBe(403);
    }
    expect((await callRoute(t.db, aiRoute.GET, { as: "viewer" })).status).toBe(200);
    expect((await callRoute(t.db, aiRoute.GET, { as: null })).status).toBe(401);
  });

  it("refuses live mode without a key", async () => {
    const r = await callRoute(t.db, aiRoute.PATCH, { method: "PATCH", body: { mode: "live" } });
    expect(r.status).toBe(400);
  });

  it("stores the key encrypted and never returns it", async () => {
    const put = await callRoute(t.db, aiKeyRoute.PUT, { method: "PUT", body: { apiKey: FAKE_KEY } });
    expect(put.status).toBe(200);
    expect(JSON.stringify(put.json)).not.toContain(FAKE_KEY);
    const get = await callRoute(t.db, aiRoute.GET, {});
    const text = JSON.stringify(get.json);
    expect(text).not.toContain(FAKE_KEY);
    expect(get.json.key).toMatchObject({ configured: true, source: "workspace", masked: "••••ABCD" });
    const live = await callRoute(t.db, aiRoute.PATCH, { method: "PATCH", body: { mode: "live", models: { text: "gpt-test" } } });
    expect(live.json.effectiveMode).toBe("live");
    expect(live.json.models.text).toBe("gpt-test");
    const logs = await t.db.select().from(auditLogs);
    expect(JSON.stringify(logs)).not.toContain(FAKE_KEY);
  });

  it("tests the key against the free models endpoint (mocked fetch)", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "a" }, { id: "b" }] }), { status: 200 }));
    const r = await callRoute(t.db, aiTestRoute.POST, { method: "POST" });
    expect(r.json).toMatchObject({ ok: true, modelCount: 2 });
    expect(String(spy.mock.calls[0][0])).toMatch(/\/models$/);
    spy.mockResolvedValue(new Response("{}", { status: 401 }));
    const bad = await callRoute(t.db, aiTestRoute.POST, { method: "POST" });
    expect(bad.json.ok).toBe(false);
    spy.mockRestore();
  });

  it("removing the key reverts to demo mode", async () => {
    const r = await callRoute(t.db, aiKeyRoute.DELETE, { method: "DELETE" });
    expect(r.json.key.configured).toBe(false);
    const get = await callRoute(t.db, aiRoute.GET, {});
    expect(get.json.mode).toBe("demo");
  });

  it("validates budget, scoring and video settings", async () => {
    expect((await callRoute(t.db, budgetRoute.PATCH, { method: "PATCH", body: { dailyUsd: 10, monthlyUsd: 5, perVideoUsd: 1, fxThbPerUsd: 36 } })).status).toBe(400);
    const b = await callRoute(t.db, budgetRoute.PATCH, { method: "PATCH", body: { dailyUsd: 3, monthlyUsd: 50, perVideoUsd: 0.5, fxThbPerUsd: 35 } });
    expect(b.json.budget.dailyUsd).toBe(3);
    expect(b.json.spent).toMatchObject({ todayUsd: 0 });
    const zero = { commissionAmount: 0, sales: 0, rating: 0, commissionRate: 0, trend: 0, content: 0 };
    expect((await callRoute(t.db, scoringRoute.PATCH, { method: "PATCH", body: zero })).status).toBe(400);
    expect((await callRoute(t.db, scoringRoute.PATCH, { method: "PATCH", body: { ...zero, commissionAmount: 50, content: 50 } })).status).toBe(200);
    expect((await callRoute(t.db, videoRoute.PATCH, { method: "PATCH", body: { generativeEnabled: true } })).status).toBe(400); // AI not live
    const v = await callRoute(t.db, videoRoute.GET, {});
    expect(v.json.media.fontsReady).toBe(true);
    const s = await callRoute(t.db, systemRoute.GET, {});
    expect(s.json.db.driver).toBe("pglite");
    expect(JSON.stringify(s.json)).not.toMatch(/sk-|secret-test/);
  });
});

describe("users & last-admin protection", () => {
  it("creates users with a temporary password and protects the last admin", async () => {
    const c = await callRoute(t.db, usersRoute.POST, { body: { email: "New@Example.com", name: "New Editor", role: "editor" } });
    expect(c.status).toBe(200);
    expect(c.json.temporaryPassword).toBeTruthy();
    expect((await callRoute(t.db, usersRoute.POST, { body: { email: "new@example.com", name: "Dup", role: "viewer" } })).status).toBe(409);
    const [admin] = await t.db.select().from(users).where(eq(users.email, "admin@example.com"));
    const demote = await callRoute(t.db, userRoute.PATCH, { method: "PATCH", params: { id: admin.id }, body: { role: "editor" } });
    expect(demote.status).toBe(409);
    expect(demote.json.code).toBe("last_admin");
    // promote another admin, then demotion is allowed
    await callRoute(t.db, userRoute.PATCH, { method: "PATCH", params: { id: c.json.user.id }, body: { role: "admin" } });
    expect((await callRoute(t.db, userRoute.PATCH, { method: "PATCH", params: { id: admin.id }, body: { isActive: false } })).json.code).toBe("self_lockout");
    const reset = await callRoute(t.db, userRoute.PATCH, { method: "PATCH", params: { id: c.json.user.id }, body: { resetPassword: true } });
    expect(reset.json.temporaryPassword).toBeTruthy();
    const list = await callRoute(t.db, usersRoute.GET, {});
    expect(list.json.items.length).toBe(5);
    expect(JSON.stringify(list.json)).not.toContain("passwordHash");
    const logs = await callRoute(t.db, auditRoute.GET, { url: "http://localhost/api/audit-logs?action=users" });
    expect(logs.json.items.length).toBeGreaterThanOrEqual(3);
  });
});

describe("job queue operations", () => {
  it("lists, retries and cancels jobs with RBAC and keeps project status consistent", async () => {
    const [offer] = await t.db.select().from(marketplaceOffers).limit(1);
    const [project] = await t.db
      .insert(videoProjects)
      .values({ workspaceId: t.workspaceId, productId: offer.productId, offerId: offer.id, title: "p", status: "rendering" })
      .returning();
    const { job } = await enqueueJob(t.db, { workspaceId: t.workspaceId, type: "video.render", payload: { projectId: project.id }, projectId: project.id, maxAttempts: 1 });
    const claimed = await claimNextJob(t.db, "w");
    await failJob(t.db, claimed!, "ffmpeg crashed");
    const list = await callRoute(t.db, jobsRoute.GET, { url: "http://localhost/api/jobs?status=failed" });
    expect(list.json.items.map((j: { id: string }) => j.id)).toContain(job.id);
    expect(list.json.items[0].projectTitle).toBe("p");
    expect((await callRoute(t.db, jobRetry.POST, { method: "POST", params: { id: job.id }, as: "viewer" })).status).toBe(403);
    expect((await callRoute(t.db, jobCancel.POST, { method: "POST", params: { id: job.id } })).status).toBe(409); // failed → can't cancel
    const retried = await callRoute(t.db, jobRetry.POST, { method: "POST", params: { id: job.id }, as: "editor" });
    expect(retried.json.job.status).toBe("queued");
    let [p] = await t.db.select().from(videoProjects).where(eq(videoProjects.id, project.id));
    expect(p.status).toBe("queued_render");
    const canceled = await callRoute(t.db, jobCancel.POST, { method: "POST", params: { id: job.id } });
    expect(canceled.json.job.status).toBe("canceled");
    [p] = await t.db.select().from(videoProjects).where(eq(videoProjects.id, project.id));
    expect(p.status).toBe("awaiting_approval");
    const detail = await callRoute(t.db, jobRoute.GET, { params: { id: job.id } });
    expect(detail.json.events.length).toBeGreaterThanOrEqual(3);
    const summary = await callRoute(t.db, jobSummary.GET, {});
    expect(summary.json.counts.canceled).toBeGreaterThanOrEqual(1);
    expect(summary.json.worker.queueDriver).toBe("db");
    const [j] = await t.db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(j.status).toBe("canceled");
  });
});
