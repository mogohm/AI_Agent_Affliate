import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb, callRoute, type TestCtx } from "../helpers";
import { automationRuns, jobs, marketplaceOffers, videoProjects } from "@/db/schema";

// Isolate from the Video module: a minimal project factory honouring the contract.
vi.mock("@/lib/video/projects", async () => {
  const { getDb } = await import("@/db/client");
  const schema = await import("@/db/schema");
  const { eq: eqOp } = await import("drizzle-orm");
  return {
    createVideoProject: async (_db: unknown, workspaceId: string, input: { offerId: string; automationRuleId?: string | null; batchId?: string | null }) => {
      const db = await getDb();
      const [o] = await db.select().from(schema.marketplaceOffers).where(eqOp(schema.marketplaceOffers.id, input.offerId));
      const [p] = await db
        .insert(schema.videoProjects)
        .values({ workspaceId, productId: o.productId, offerId: o.id, title: "auto", automationRuleId: input.automationRuleId ?? null, batchId: input.batchId ?? null })
        .returning();
      return p;
    },
    enqueueScriptGeneration: async (_db: unknown, workspaceId: string, projectId: string) => {
      const { enqueueJob } = await import("@/lib/jobs/queue");
      const db = await getDb();
      const { job } = await enqueueJob(db, { workspaceId, type: "video.generate_script", payload: { projectId }, projectId, idempotencyKey: `script:${projectId}` });
      return { jobId: job.id };
    },
    enqueueRender: async () => ({ jobId: "x" }),
    estimateProjectCostUsd: async () => ({ totalUsd: 0, lines: [] }),
  };
});

const rulesRoute = await import("@/app/api/automation/rules/route");
const ruleRoute = await import("@/app/api/automation/rules/[id]/route");
const dryRunRoute = await import("@/app/api/automation/rules/[id]/dry-run/route");
const runRoute = await import("@/app/api/automation/rules/[id]/run/route");
const runsRoute = await import("@/app/api/automation/runs/route");
const { runDueSchedules, handleAutomationJob } = await import("@/lib/automation/engine");
const { setSetting } = await import("@/lib/settings");

let t: TestCtx;
beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(async () => t.close());

const ruleBody = {
  name: "ค่าคอม ≥ ฿60",
  enabled: true,
  conditions: { minCommissionAmount: 60, excludeAlreadyProduced: true },
  actions: { templateKey: "product-showcase", language: "th", renderMode: "hybrid", videosPerDay: 2, autoGenerateScript: true, autoRender: false, requireApproval: true },
  schedule: "manual",
  scheduleTime: "09:00",
};

describe("automation rules API", () => {
  let ruleId: string;

  it("viewer cannot create rules; editor can", async () => {
    expect((await callRoute(t.db, rulesRoute.POST, { body: ruleBody, as: "viewer" })).status).toBe(403);
    const r = await callRoute(t.db, rulesRoute.POST, { body: ruleBody, as: "editor" });
    expect(r.status).toBe(200);
    expect(r.json.rule.actions.requireApproval).toBe(true);
    ruleId = r.json.rule.id;
  });

  it("rejects invalid rule input", async () => {
    const r = await callRoute(t.db, rulesRoute.POST, { body: { ...ruleBody, actions: { ...ruleBody.actions, videosPerDay: 0 } } });
    expect(r.status).toBe(400);
  });

  it("dry-run lists matches sorted by commission without creating projects", async () => {
    const r = await callRoute(t.db, dryRunRoute.POST, { params: { id: ruleId } });
    expect(r.status).toBe(200);
    expect(r.json.dryRun).toBe(true);
    expect(r.json.matched).toBeGreaterThan(2);
    const amounts = r.json.planned.map((p: { estCommission: number }) => p.estCommission);
    expect([...amounts].sort((a, b) => b - a)).toEqual(amounts);
    expect(amounts.every((a: number) => a >= 60)).toBe(true);
    expect(r.json.planned.length).toBe(2);
    expect(r.json.estimateTotalUsd).toBe(0); // demo mode
    expect((await t.db.select().from(videoProjects)).length).toBe(0);
    const runs = await t.db.select().from(automationRuns).where(eq(automationRuns.ruleId, ruleId));
    expect(runs[0].dryRun).toBe(true);
  });

  it("run creates ≤ videosPerDay projects + script jobs; second run same day creates 0", async () => {
    const r1 = await callRoute(t.db, runRoute.POST, { params: { id: ruleId } });
    expect(r1.status).toBe(200);
    expect(r1.json.createdProjectIds.length).toBe(2);
    expect(r1.json.message).toContain("อนุมัติ");
    const projects = await t.db.select().from(videoProjects).where(eq(videoProjects.automationRuleId, ruleId));
    expect(projects.length).toBe(2);
    const scriptJobs = await t.db.select().from(jobs).where(eq(jobs.type, "video.generate_script"));
    expect(scriptJobs.length).toBe(2);
    const r2 = await callRoute(t.db, runRoute.POST, { params: { id: ruleId } });
    expect(r2.json.createdProjectIds.length).toBe(0);
    expect(r2.json.status).toBe("skipped");
    expect(r2.json.message).toContain("โควตา");
  });

  it("budget guard blocks paid runs before dispatch", async () => {
    // Simulate live mode by spending over budget is not enough (demo cost = 0), so test the guard via the per-video ceiling path using a live-like rule:
    const created = await callRoute(t.db, rulesRoute.POST, {
      body: { ...ruleBody, name: "budget", conditions: { minCommissionAmount: 1, excludeAlreadyProduced: false }, actions: { ...ruleBody.actions, videosPerDay: 5 } },
    });
    const id = created.json.rule.id;
    const { recordUsage } = await import("@/lib/ai/usage");
    await setSetting(t.db, t.workspaceId, "budget", { dailyUsd: 0.01, monthlyUsd: 1, perVideoUsd: 1, fxThbPerUsd: 36 });
    await recordUsage(t.db, { workspaceId: t.workspaceId, provider: "openai", operation: "x", units: 1, unit: "requests", costUsd: 0.5 });
    // demo mode → estimate 0 → still allowed (no paid work)
    const ok = await callRoute(t.db, dryRunRoute.POST, { params: { id } });
    expect(ok.json.budget.ok).toBe(true);
    // live-mode estimate: patch ai.mode via settings + mock key so getAiContext returns live
    await setSetting(t.db, t.workspaceId, "ai.mode", "live");
    process.env.OPENAI_API_KEY = "sk-test-not-real-0000000000000000";
    const { resetEnvCache } = await import("@/lib/env");
    resetEnvCache();
    const blocked = await callRoute(t.db, runRoute.POST, { params: { id } });
    expect(blocked.json.status).toBe("failed");
    expect(blocked.json.message).toContain("งบ");
    expect(blocked.json.createdProjectIds.length).toBe(0);
    process.env.OPENAI_API_KEY = "";
    resetEnvCache();
    await setSetting(t.db, t.workspaceId, "ai.mode", "demo");
  });

  it("toggle, list runs, scheduler + job handler", async () => {
    const p = await callRoute(t.db, ruleRoute.PATCH, { method: "PATCH", params: { id: ruleId }, body: { enabled: false } });
    expect(p.json.rule.enabled).toBe(false);
    const runs = await callRoute(t.db, runsRoute.GET, {});
    expect(runs.json.items.length).toBeGreaterThan(2);
    // daily schedule due
    await callRoute(t.db, ruleRoute.PATCH, { method: "PATCH", params: { id: ruleId }, body: { enabled: true, schedule: "daily", scheduleTime: "00:00" } });
    const { automationRules } = await import("@/db/schema");
    await t.db.update(automationRules).set({ lastRunAt: new Date(Date.now() - 3 * 86_400_000) }).where(eq(automationRules.id, ruleId));
    expect(await runDueSchedules(t.db)).toBeGreaterThanOrEqual(1);
    expect(await runDueSchedules(t.db)).toBe(0); // idempotent per day
    const [job] = await t.db.select().from(jobs).where(eq(jobs.type, "automation.run"));
    const out = await handleAutomationJob({ db: t.db, job, progress: async () => {}, log: async () => {}, isCanceled: async () => false });
    expect(out.status).toBe("skipped"); // quota already used today
    const del = await callRoute(t.db, ruleRoute.DELETE, { method: "DELETE", params: { id: ruleId } });
    expect(del.status).toBe(200);
  });

  it("offers referenced exist", async () => {
    expect((await t.db.select().from(marketplaceOffers)).length).toBeGreaterThan(0);
  });
});
