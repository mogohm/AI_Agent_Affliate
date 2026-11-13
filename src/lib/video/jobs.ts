import { eq } from "drizzle-orm";
import { videoProjects, videoScenes } from "@/db/schema";
import { getAiContext } from "@/lib/ai/context";
import { checkBudget, recordUsage } from "@/lib/ai/usage";
import { getSetting } from "@/lib/settings";
import { JobCanceledError, PermanentJobError, type JobContext, type JobHandler } from "@/lib/jobs/types";
import { generateDemoScript } from "./script-demo";
import { generateOpenAIScript } from "./openai-providers";
import { getProject, getTemplate, getTemplateById } from "./projects";
import { renderProject } from "./render";
import type { ScriptDraft } from "./script-types";

function projectIdOf(ctx: JobContext): string {
  const id = ctx.job.payload.projectId;
  if (typeof id !== "string") throw new PermanentJobError("payload.projectId missing");
  return id;
}

/** Mark the project failed when this is the final attempt (or a permanent error). */
async function onFailure(ctx: JobContext, projectId: string, err: unknown) {
  const canceled = err instanceof JobCanceledError || (await ctx.isCanceled());
  const permanent = !!(err as { permanent?: boolean })?.permanent;
  const final = permanent || canceled || ctx.job.attempts >= ctx.job.maxAttempts;
  if (!final) return;
  await ctx.db
    .update(videoProjects)
    .set({ status: canceled ? "canceled" : "failed", error: canceled ? "ยกเลิกโดยผู้ใช้" : err instanceof Error ? err.message.slice(0, 1000) : String(err), updatedAt: new Date() })
    .where(eq(videoProjects.id, projectId));
}

export const handleGenerateScript: JobHandler = async (ctx) => {
  const projectId = projectIdOf(ctx);
  try {
    const { db, job } = ctx;
    const p = await getProject(db, job.workspaceId, projectId);
    if (!p.facts) throw new PermanentJobError("โปรเจกต์ไม่มีข้อมูลสินค้า (facts)");
    const tpl = (p.templateId && (await getTemplateById(db, p.templateId))) || (await getTemplate(db, job.workspaceId, null));
    const disclosure = await getSetting(db, job.workspaceId, "publishing.disclosureText");
    const req = {
      facts: p.facts,
      style: tpl.style,
      structure: tpl.config.structure,
      templatePrompt: tpl.prompt,
      language: p.language,
      durationSec: p.durationSec,
      disclosureText: disclosure[p.language],
      visualStyle: p.visualStyle,
    };
    await ctx.progress(15, "วิเคราะห์ข้อมูลสินค้า");
    const ai = await getAiContext(db, job.workspaceId);
    let draft: ScriptDraft;
    if (ai.mode === "live") {
      const est = (2500 / 1e6) * ai.pricing.textInputPer1M + (1500 / 1e6) * ai.pricing.textOutputPer1M;
      const b = await checkBudget(db, job.workspaceId, est);
      if (!b.ok) throw new PermanentJobError(b.reason ?? "เกินงบประมาณ");
      await ctx.progress(30, `สร้างสคริปต์ด้วย ${ai.models.text}`);
      const r = await generateOpenAIScript(ai, req);
      await recordUsage(db, { workspaceId: job.workspaceId, provider: "openai", model: r.usage.model, operation: r.usage.operation, units: r.usage.units, unit: r.usage.unit, costUsd: r.usage.costUsd, projectId, jobId: job.id });
      draft = r.draft;
    } else {
      await ctx.progress(40, "สร้างสคริปต์ด้วย Demo generator");
      draft = generateDemoScript(req);
    }
    if (await ctx.isCanceled()) throw new JobCanceledError("canceled");
    await ctx.progress(80, "บันทึก Storyboard");
    await db.delete(videoScenes).where(eq(videoScenes.projectId, projectId));
    await db.insert(videoScenes).values(
      draft.scenes.map((s, i) => ({
        projectId,
        idx: i,
        durationSec: s.durationSec,
        title: s.title,
        voiceover: s.voiceover,
        caption: s.caption,
        visualPrompt: s.visualPrompt,
        shotType: s.shotType,
      })),
    );
    const durationSec = Math.round(draft.scenes.reduce((a, s) => a + s.durationSec, 0));
    await db
      .update(videoProjects)
      .set({
        script: draft.script,
        scriptGenerator: draft.generator === "openai" ? `openai:${draft.model}` : "demo",
        durationSec: durationSec || p.durationSec,
        status: "awaiting_approval",
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(videoProjects.id, projectId));
    for (const w of draft.warnings) await ctx.log("warn", w);
    return { scenes: draft.scenes.length, generator: draft.generator, model: draft.model, warnings: draft.warnings };
  } catch (err) {
    await onFailure(ctx, projectId, err);
    throw err;
  }
};

export const handleRender: JobHandler = async (ctx) => {
  const projectId = projectIdOf(ctx);
  try {
    return await renderProject(ctx, projectId);
  } catch (err) {
    await onFailure(ctx, projectId, err);
    throw err;
  }
};
