import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { callRoute, setupTestDb, type TestCtx } from "../helpers";
import { jobs, marketplaceOffers, mediaAssets, videoProjects, videoScenes } from "@/db/schema";
import { resetEnvCache } from "@/lib/env";
import { drainQueue } from "@/lib/jobs/worker";
import { getStorage } from "@/lib/storage";
import { probeMedia } from "@/lib/media/ffmpeg";
import { setSecret, setSetting } from "@/lib/settings";
import { __setOpenAIFactory } from "@/lib/ai/context";
import { recordUsage } from "@/lib/ai/usage";
import * as projectsRoute from "@/app/api/video-projects/route";
import * as batchRoute from "@/app/api/video-projects/batch/route";
import * as scriptRoute from "@/app/api/video-projects/[id]/script/route";
import * as approveScriptRoute from "@/app/api/video-projects/[id]/approve-script/route";
import * as renderRoute from "@/app/api/video-projects/[id]/render/route";
import * as approveRoute from "@/app/api/video-projects/[id]/approve/route";
import * as exportRoute from "@/app/api/video-projects/[id]/export/route";
import * as publishRoute from "@/app/api/video-projects/[id]/publish/route";
import * as projectRoute from "@/app/api/video-projects/[id]/route";
import * as storyboardRoute from "@/app/api/video-projects/[id]/storyboard/route";
import * as filesRoute from "@/app/api/files/[id]/route";
import * as templatesRoute from "@/app/api/templates/route";

let t: TestCtx;
let offerId: string;

beforeAll(async () => {
  Object.assign(process.env, { RENDER_WIDTH: "360", RENDER_HEIGHT: "640", RENDER_FPS: "15", LOCAL_STORAGE_DIR: path.join(os.tmpdir(), `aas-video-test-${process.pid}`) });
  resetEnvCache();
  t = await setupTestDb();
  const [o] = await t.db.select().from(marketplaceOffers).where(eq(marketplaceOffers.externalProductId, "DEMO-001"));
  offerId = o.id;
});
afterAll(async () => {
  __setOpenAIFactory(undefined);
  await t.close();
});

describe("video studio workflow (demo mode, hybrid render)", () => {
  let projectId: string;

  it("viewer cannot create; editor can", async () => {
    const denied = await callRoute(t.db, projectsRoute.POST, { as: "viewer", body: { offerId } });
    expect(denied.status).toBe(403);
    const ok = await callRoute(t.db, projectsRoute.POST, { as: "editor", body: { offerId, templateKey: "product-showcase", durationSec: 12 } });
    expect(ok.status).toBe(200);
    projectId = ok.json.project.id;
    expect(ok.json.project.facts.title).toContain("ไฟวงแหวน");
    expect(ok.json.project.status).toBe("created");
  });

  it("generates a demo script + storyboard via the queue", async () => {
    const r = await callRoute(t.db, scriptRoute.POST, { as: "editor", params: { id: projectId } });
    expect(r.status).toBe(200);
    expect(await drainQueue(t.db)).toEqual(["succeeded"]);
    const [p] = await t.db.select().from(videoProjects).where(eq(videoProjects.id, projectId));
    expect(p.status).toBe("awaiting_approval");
    expect(p.scriptGenerator).toBe("demo");
    expect(p.script?.disclosure).toContain("Affiliate");
    const scenes = await t.db.select().from(videoScenes).where(eq(videoScenes.projectId, projectId));
    expect(scenes.length).toBe(4);
  });

  it("allows editing the storyboard", async () => {
    const detail = await callRoute(t.db, projectRoute.GET, { params: { id: projectId } });
    const scenes = detail.json.scenes.map((s: any) => ({ id: s.id, durationSec: 3, title: s.title, caption: s.caption, voiceover: s.voiceover, visualPrompt: s.visualPrompt, shotType: s.shotType }));
    scenes[1].caption = "แก้ไขคำบรรยายฉากที่ 2";
    const r = await callRoute(t.db, storyboardRoute.PUT, { method: "PUT", as: "editor", params: { id: projectId }, body: { scenes } });
    expect(r.status).toBe(200);
    expect(r.json.project.durationSec).toBe(12);
  });

  it("approves script → renders a real 9:16 MP4", async () => {
    const r = await callRoute(t.db, approveScriptRoute.POST, { as: "editor", params: { id: projectId } });
    expect(r.status).toBe(200);
    const started = Date.now();
    expect(await drainQueue(t.db)).toEqual(["succeeded"]);
    console.log(`render took ${((Date.now() - started) / 1000).toFixed(1)}s`);
    const [p] = await t.db.select().from(videoProjects).where(eq(videoProjects.id, projectId));
    expect(p.status).toBe("quality_review");
    expect(p.outputAssetId).toBeTruthy();
    const [asset] = await t.db.select().from(mediaAssets).where(eq(mediaAssets.id, p.outputAssetId!));
    const buf = await getStorage().get(asset.storageKey);
    expect(buf.length).toBeGreaterThan(10_000);
    const file = path.join(os.tmpdir(), `aas-probe-${process.pid}.mp4`);
    await fs.writeFile(file, buf);
    const info = await probeMedia(file);
    expect(info.width).toBe(360);
    expect(info.height).toBe(640);
    expect(info.hasAudio).toBe(true);
    expect(Math.abs((info.durationSec ?? 0) - 12)).toBeLessThan(0.6);
    expect(p.thumbnailAssetId && p.subtitleAssetId).toBeTruthy();
  });

  it("serves the file with range support", async () => {
    const [p] = await t.db.select().from(videoProjects).where(eq(videoProjects.id, projectId));
    const r = await callRoute(t.db, filesRoute.GET, { params: { id: p.outputAssetId! } });
    expect(r.status).toBe(200);
    expect(r.res.headers.get("content-type")).toBe("video/mp4");
    const { NextRequest } = await import("next/server");
    const { sessionCookie } = await import("../helpers");
    const req = new NextRequest("http://localhost/api/files/x", { headers: { cookie: await sessionCookie(t.db), range: "bytes=0-99" } });
    const res = await filesRoute.GET(req, { params: Promise.resolve({ id: p.outputAssetId! }) });
    expect(res.status).toBe(206);
    expect((await res.arrayBuffer()).byteLength).toBe(100);
  });

  it("editor cannot approve; approver can; export returns download URL; publish is a manual record", async () => {
    expect((await callRoute(t.db, approveRoute.POST, { as: "editor", params: { id: projectId } })).status).toBe(403);
    const ok = await callRoute(t.db, approveRoute.POST, { as: "approver", params: { id: projectId }, body: { note: "ตรวจแล้ว" } });
    expect(ok.status).toBe(200);
    expect(ok.json.project.status).toBe("approved");
    const ex = await callRoute(t.db, exportRoute.POST, { as: "editor", params: { id: projectId } });
    expect(ex.status).toBe(200);
    expect(ex.json.downloadUrl).toContain("/api/files/");
    expect((await callRoute(t.db, publishRoute.POST, { as: "editor", params: { id: projectId }, body: { channel: "tiktok" } })).status).toBe(403);
    const pub = await callRoute(t.db, publishRoute.POST, { as: "approver", params: { id: projectId }, body: { channel: "tiktok", postUrl: "https://www.tiktok.com/@demo/video/1" } });
    expect(pub.status).toBe(200);
    expect(pub.json.project.status).toBe("published");
  });

  it("lists projects by library group and creates batches", async () => {
    const list = await callRoute(t.db, projectsRoute.GET, { url: "http://localhost/api/video-projects?group=published" });
    expect(list.json.items.length).toBe(1);
    const [o2] = await t.db.select().from(marketplaceOffers).where(eq(marketplaceOffers.externalProductId, "DEMO-003"));
    const b = await callRoute(t.db, batchRoute.POST, { as: "editor", body: { offerIds: [offerId, o2.id], templateKey: "three-benefits" } });
    expect(b.status).toBe(200);
    expect(b.json.projects.length).toBe(2);
    const queued = await t.db.select().from(jobs).where(eq(jobs.type, "video.generate_script"));
    expect(queued.filter((j) => j.status === "queued").length).toBe(2);
    await drainQueue(t.db);
  });

  it("template edits create a new version and require settings:manage", async () => {
    const list = await callRoute(t.db, templatesRoute.GET);
    const tpl = list.json.items.find((x: any) => x.key === "promotional");
    expect((await callRoute(t.db, templatesRoute.PATCH, { method: "PATCH", as: "editor", body: { id: tpl.id, name: "x" } })).status).toBe(403);
    const r = await callRoute(t.db, templatesRoute.PATCH, { method: "PATCH", body: { id: tpl.id, name: "Promo v2" } });
    expect(r.status).toBe(200);
    expect(r.json.template.version).toBe(2);
  });
});

describe("live mode guards (mocked OpenAI — no network)", () => {
  it("generative mode is rejected unless enabled; budget blocks paid render", async () => {
    const c = await callRoute(t.db, projectsRoute.POST, { body: { offerId, renderMode: "generative" } });
    const id = c.json.project.id;
    await callRoute(t.db, scriptRoute.POST, { params: { id } });
    await drainQueue(t.db);
    const rej = await callRoute(t.db, renderRoute.POST, { params: { id } });
    expect(rej.status).toBe(409);
    expect(rej.json.error).toContain("Live AI");

    // Live mode with a fake client and a tiny budget → render blocked before dispatch
    await setSetting(t.db, t.workspaceId, "ai.mode", "live");
    await setSecret(t.db, t.workspaceId, "secret.openaiApiKey", "sk-test-fake");
    __setOpenAIFactory(() => ({}) as never);
    await setSetting(t.db, t.workspaceId, "budget", { dailyUsd: 0.05, monthlyUsd: 1, perVideoUsd: 0.01, fxThbPerUsd: 36 });
    await t.db.update(videoProjects).set({ renderMode: "hybrid" }).where(eq(videoProjects.id, id));
    const blocked = await callRoute(t.db, renderRoute.POST, { params: { id } });
    expect(blocked.status).toBe(402);
    expect(blocked.json.code).toBe("budget_exceeded");
    await recordUsage(t.db, { workspaceId: t.workspaceId, provider: "x", operation: "x", units: 1, unit: "requests", costUsd: 0 });
    await setSetting(t.db, t.workspaceId, "ai.mode", "demo");
  });

  it("live script generation uses structured output and drops claims citing unknown fields", async () => {
    await setSetting(t.db, t.workspaceId, "ai.mode", "live");
    await setSetting(t.db, t.workspaceId, "budget", { dailyUsd: 5, monthlyUsd: 100, perVideoUsd: 1, fxThbPerUsd: 36 });
    const output = {
      hook: "ไฟวงแหวนตัวนี้น่าสนใจ",
      body: "ปรับได้ 3 โทนสี",
      cta: "ดูราคาที่ลิงก์",
      caption: "ไฟวงแหวน",
      hashtags: ["#Affiliate"],
      scenes: [
        { durationSec: 4, title: "Hook", voiceover: "ไฟวงแหวนตัวนี้", caption: "ไฟวงแหวน", visualPrompt: "studio", shotType: "hook" },
        { durationSec: 4, title: "Benefit", voiceover: "ปรับได้ 3 โทนสี", caption: "3 โทนสี", visualPrompt: "studio", shotType: "benefit" },
        { durationSec: 4, title: "CTA", voiceover: "ดูราคาที่ลิงก์", caption: "ดูราคาที่ลิงก์", visualPrompt: "studio", shotType: "cta" },
      ],
      claims: [
        { text: "3 โทนสี", sourceField: "attributes.โทนสี" },
        { text: "กันน้ำ IPX7", sourceField: "attributes.waterproof" },
      ],
    };
    __setOpenAIFactory(() => ({ responses: { create: async () => ({ output_text: JSON.stringify(output), usage: { input_tokens: 1000, output_tokens: 500 } }) } }) as never);
    const c = await callRoute(t.db, projectsRoute.POST, { body: { offerId } });
    const id = c.json.project.id;
    await callRoute(t.db, scriptRoute.POST, { params: { id } });
    expect(await drainQueue(t.db)).toEqual(["succeeded"]);
    const [p] = await t.db.select().from(videoProjects).where(eq(videoProjects.id, id));
    expect(p.scriptGenerator).toMatch(/^openai:/);
    expect(p.script?.claims.map((x) => x.sourceField)).toEqual(["attributes.โทนสี"]);
    expect(Number(p.actualCostUsd)).toBeGreaterThan(0);
    await setSetting(t.db, t.workspaceId, "ai.mode", "demo");
    __setOpenAIFactory(undefined);
  });
});
