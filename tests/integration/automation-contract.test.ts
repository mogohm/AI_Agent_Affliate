import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb, type TestCtx } from "../helpers";
import { automationRules, jobs, videoProjects } from "@/db/schema";
import { runRule } from "@/lib/automation/engine";

/** Automation ↔ Video module contract, using the real createVideoProject / enqueueScriptGeneration. */
let t: TestCtx;
beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(async () => t.close());

describe("automation with real video project service", () => {
  it("creates projects with fact snapshots and queues script generation", async () => {
    const [rule] = await t.db
      .insert(automationRules)
      .values({
        workspaceId: t.workspaceId,
        name: "contract",
        enabled: true,
        conditions: { minCommissionAmount: 100 },
        actions: { templateKey: "product-showcase", language: "th", renderMode: "hybrid", videosPerDay: 2, autoGenerateScript: true, autoRender: false, requireApproval: true },
      })
      .returning();
    const r = await runRule(t.db, t.workspaceId, rule.id, { dryRun: false });
    expect(r.errors).toEqual([]);
    expect(r.createdProjectIds).toHaveLength(2);
    const projects = await t.db.select().from(videoProjects).where(eq(videoProjects.automationRuleId, rule.id));
    expect(projects.every((p) => p.facts && p.batchId && p.status === "script_generating")).toBe(true);
    const scriptJobs = await t.db.select().from(jobs).where(eq(jobs.type, "video.generate_script"));
    expect(scriptJobs).toHaveLength(2);
  });
});
