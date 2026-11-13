"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Download, FileText, Plus, RefreshCw, Send, Sparkles, Trash2, Undo2, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormRow, Input, Select, Textarea } from "@/components/ui/form";
import { SwitchRow } from "@/components/ui/switch";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ErrorState, LoadingRows, Note, Progress } from "@/components/ui/states";
import { OriginBadge, PlatformLabel, VideoStatusBadge } from "@/components/data-badges";
import { useCan, useSession } from "@/components/session-context";
import { api, useApi } from "@/lib/client/api";
import { dateTime, thb, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AffiliateVideoProps } from "@/remotion/AffiliateVideo";
import { PhonePreview } from "./phone-preview";
import { VISUAL_STYLE_OPTIONS, type ProjectBundle, type SceneRow, type TemplateRow } from "./types";

const PROCESSING = ["script_generating", "queued_render", "asset_generation", "rendering"];
const SHOT_TYPES = ["hook", "problem", "solution", "showcase", "benefit", "cta"] as const;
type EditScene = Pick<SceneRow, "durationSec" | "title" | "voiceover" | "caption" | "visualPrompt" | "shotType">;

function stepStates(b: ProjectBundle) {
  const s = b.project.status;
  const after = (list: string[]) => list.includes(s);
  const rendered = !!b.urls.video;
  return [
    { key: "product", label: "Select Product", done: true },
    { key: "analysis", label: "AI Analysis", done: !!b.score, note: b.score ? `✦ ${b.score.score ?? "—"}` : "ยังไม่วิเคราะห์" },
    { key: "script", label: "Script", done: !!b.project.script, active: s === "script_generating" || s === "created" },
    { key: "storyboard", label: "Storyboard", done: b.scenes.length > 0, active: s === "awaiting_approval" },
    { key: "image", label: "Image Generation", done: b.assets.some((a) => a.kind === "image") || rendered, active: s === "asset_generation" || s === "queued_render" },
    { key: "voice", label: "Voiceover", done: b.project.voice === "none" ? rendered : b.assets.some((a) => a.kind === "audio"), note: b.project.voice === "none" ? "ไม่ใช้" : undefined },
    { key: "render", label: "Video Rendering", done: rendered, active: s === "rendering" },
    { key: "preview", label: "Preview / QA", done: after(["approved", "exported", "published"]), active: s === "quality_review" },
    { key: "export", label: "Export", done: after(["exported", "published"]), active: s === "approved" },
  ];
}

export function StudioEditor({ id }: { id: string }) {
  const router = useRouter();
  const session = useSession();
  const canCreate = useCan("video:create");
  const canApprove = useCan("video:approve");
  const canPublish = useCan("video:publish");
  const canExport = useCan("video:export");
  const [poll, setPoll] = React.useState(0);
  const { data, error, loading, reload } = useApi<ProjectBundle>(`/api/video-projects/${id}`, { refreshMs: poll });
  const templates = useApi<{ items: TemplateRow[] }>("/api/templates");
  const [scenes, setScenes] = React.useState<EditScene[]>([]);
  const [dirty, setDirty] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [exportInfo, setExportInfo] = React.useState<{ downloadUrl: string; subtitleUrl: string | null; caption: string | null; affiliateUrl: string | null } | null>(null);

  const status = data?.project.status;
  const processing = !!status && PROCESSING.includes(status);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- poll faster while the worker is busy
  React.useEffect(() => setPoll(processing ? 2000 : 0), [processing]);

  const syncKey = data ? `${data.project.updatedAt}:${data.scenes.length}` : "";
  React.useEffect(() => {
    if (!data || dirty) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync server storyboard into the editor when not editing
    setScenes(data.scenes.map(({ durationSec, title, voiceover, caption, visualPrompt, shotType }) => ({ durationSec, title, voiceover, caption, visualPrompt, shotType })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncKey]);

  if (loading && !data) return <LoadingRows rows={8} />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;
  const p = data.project;
  const facts = p.facts;
  const locked = processing || p.status === "published";
  const latestJob = data.jobs[0];
  const scriptJob = data.jobs.find((j) => j.type === "video.generate_script" && j.status === "succeeded");
  const warnings = ((scriptJob?.result?.warnings as string[] | undefined) ?? []).filter(Boolean);
  const totalDur = scenes.reduce((a, s) => a + Number(s.durationSec || 0), 0);

  const act = async (name: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(name);
    try {
      await fn();
      if (ok) toast.success(ok);
      await reload();
      setPoll(2000);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const patch = (body: Record<string, unknown>) => act("patch", () => api(`/api/video-projects/${id}`, { method: "PATCH", body }), "บันทึกการตั้งค่าแล้ว");
  const saveStoryboard = () =>
    act("storyboard", async () => {
      await api(`/api/video-projects/${id}/storyboard`, { method: "PUT", body: { scenes: scenes.map((s) => ({ ...s, durationSec: Number(s.durationSec) })) } });
      setDirty(false);
    }, "บันทึก Storyboard แล้ว");
  const updateScene = (i: number, patchS: Partial<EditScene>) => {
    setScenes((arr) => arr.map((s, j) => (j === i ? { ...s, ...patchS } : s)));
    setDirty(true);
  };

  const preview: AffiliateVideoProps = {
    scenes: scenes.map((s) => ({ durationSec: Math.max(1, Number(s.durationSec) || 1), caption: s.caption, voiceover: s.voiceover, shotType: s.shotType })),
    palette: data.template?.config.palette ?? { from: "#38347a", to: "#14546f", accent: "#8d7dfb" },
    productTitle: facts?.title ?? data.product?.title ?? "",
    brand: facts?.brand ?? null,
    priceText: facts?.price != null ? thb(facts.price) : null,
    disclosure: p.disclosure ? (p.language === "th" ? "#โฆษณา · ลิงก์ Affiliate" : "#ad · Affiliate link") : null,
    subtitles: p.subtitles,
    emoji: data.product?.demoEmoji ?? null,
    placeholderLabel: p.language === "th" ? "ภาพประกอบ — ไม่ใช่ภาพสินค้าจริง" : "Illustration — not the actual product",
  };

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link href="/studio" className="mb-1 inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
            <ArrowLeft className="size-3.5" /> AI Video Studio
          </Link>
          <h2 className="truncate text-[22px] font-bold tracking-tight" data-testid="project-title">{p.title}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            <VideoStatusBadge status={p.status} />
            <span>{data.template?.name} v{data.template?.version}</span>
            <span>· {p.aspectRatio} · {p.durationSec}s · {p.language.toUpperCase()}</span>
            <Badge tone={p.scriptGenerator?.startsWith("openai") ? "green" : "muted"}>{p.scriptGenerator ? (p.scriptGenerator.startsWith("openai") ? `AI: ${p.scriptGenerator.replace("openai:", "")}` : "Demo generator") : "ยังไม่มีสคริปต์"}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canCreate && (
            <Button
              variant="ghost"
              size="sm"
              disabled={processing}
              onClick={async () => {
                if (!confirm("ลบโปรเจกต์นี้และไฟล์ที่เกี่ยวข้อง?")) return;
                await act("delete", () => api(`/api/video-projects/${id}`, { method: "DELETE" }), "ลบโปรเจกต์แล้ว");
                router.push("/studio");
              }}
            >
              <Trash2 /> ลบ
            </Button>
          )}
        </div>
      </div>

      {p.error && <ErrorState error={p.error} className="mb-4" />}

      <div className="grid gap-4 xl:grid-cols-[310px_minmax(0,1fr)_295px] lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* LEFT: preview */}
        <Card className="self-start">
          <CardHeader title="ตัวอย่างวิดีโอ" actions={<Badge tone={data.urls.video ? "green" : "orange"}>{data.urls.video ? "Rendered MP4" : "Storyboard preview"}</Badge>} />
          <PhonePreview videoUrl={data.urls.video} posterUrl={data.urls.thumbnail} preview={preview} />
          {!data.urls.video && scenes.length > 0 && <p className="mt-2 text-center text-[11px] text-muted">พรีวิวด้วย Remotion Player — ยังไม่ใช่ไฟล์ที่เรนเดอร์</p>}
          <div className="mt-4 space-y-2 border-t border-line pt-4 text-xs">
            <div className="font-bold">{facts?.title}</div>
            <div className="flex flex-wrap items-center gap-2 text-muted">
              {facts?.platform && <PlatformLabel platform={facts.platform} />}
              <span>{thb(facts?.price)}</span>
              <OriginBadge origin={facts?.dataOrigin} />
            </div>
            <div className="text-[11px] text-muted">ข้อมูล ณ {dateTime(facts?.capturedAt)} (snapshot ที่สคริปต์ใช้อ้างอิง)</div>
            {data.product?.imageRights !== "authorized" && <Note className="mt-2">ไม่มีภาพสินค้าที่ยืนยันสิทธิ์ — วิดีโอใช้ภาพประกอบ placeholder ที่ระบุชัดว่าไม่ใช่ภาพสินค้าจริง</Note>}
            <div className="rounded-xl border border-line bg-surface-2 p-3">
              <div className="mb-1 font-bold">AI Analysis</div>
              {data.score ? (
                <>
                  <div className="text-lg font-extrabold text-accent-2">✦ {data.score.score ?? "—"}<span className="text-xs text-muted">/100 · ความเชื่อมั่น {Math.round(data.score.confidence * 100)}%</span></div>
                  <p className="mt-1 text-[11px] text-muted">{data.score.explanation}</p>
                </>
              ) : (
                <p className="text-[11px] text-muted">ยังไม่มีผลวิเคราะห์ (ไปที่หน้าสินค้าเพื่อสั่ง AI วิเคราะห์)</p>
              )}
              {data.product && <Link className="mt-1 inline-block text-[11px] text-accent-2" href={`/products/${data.product.id}`}>ดูรายละเอียดสินค้า ↗</Link>}
            </div>
          </div>
        </Card>

        {/* MIDDLE: workflow + storyboard */}
        <div className="min-w-0 space-y-4">
          <Card>
            <div className="mb-3 grid grid-cols-3 gap-1.5 sm:grid-cols-9" aria-label="Workflow">
              {stepStates(data).map((st, i) => (
                <div
                  key={st.key}
                  className={cn(
                    "rounded-xl border px-2 py-2 text-center",
                    st.done ? "border-good/40 bg-good/10" : st.active ? "border-accent bg-accent/10" : "border-line",
                  )}
                  title={st.note}
                >
                  <div className={cn("text-[10px] font-extrabold", st.done ? "text-good" : st.active ? "text-accent-2" : "text-muted")}>{st.done ? "✓" : String(i + 1).padStart(2, "0")}</div>
                  <div className="text-[10px] leading-tight font-bold">{st.label}</div>
                </div>
              ))}
            </div>
            {latestJob && (latestJob.status === "queued" || latestJob.status === "running" || latestJob.status === "failed") && (
              <div className="rounded-xl border border-line bg-surface-2 p-3" data-testid="job-progress">
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <b>{latestJob.type === "video.render" ? "เรนเดอร์วิดีโอ" : "สร้างสคริปต์"}</b>
                  <span className="text-muted">
                    {latestJob.status === "queued" ? "รอคิว Worker" : latestJob.progressMessage} · ครั้งที่ {latestJob.attempts}/{latestJob.maxAttempts}
                  </span>
                </div>
                <Progress value={latestJob.status === "queued" ? 2 : latestJob.progress} />
                {latestJob.lastError && <p className="mt-1.5 text-[11px] text-danger">{latestJob.lastError}</p>}
                <Link href="/queue" className="mt-1 inline-block text-[11px] text-accent-2">ดูในคิวงาน ↗</Link>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Storyboard & Script"
              description={`${scenes.length} ฉาก · รวม ${totalDur.toFixed(1)} วินาที · ตรวจทานข้อเท็จจริงก่อนเรนเดอร์`}
              actions={
                canCreate && (
                  <>
                    <Button size="sm" variant="secondary" disabled={locked} loading={busy === "script"} onClick={() => act("script", () => api(`/api/video-projects/${id}/script`, { method: "POST" }), "เริ่มสร้างร่างสคริปต์")} data-testid="generate-script">
                      <Wand2 /> {p.script ? "สร้างร่างใหม่" : "สร้างสคริปต์"}
                    </Button>
                    {dirty && (
                      <Button size="sm" variant="primary" loading={busy === "storyboard"} onClick={saveStoryboard}>
                        บันทึก Storyboard
                      </Button>
                    )}
                  </>
                )
              }
            />
            {warnings.length > 0 && (
              <Note tone="warn" className="mb-3">
                {warnings.join(" · ")}
              </Note>
            )}
            {p.status === "script_generating" && scenes.length === 0 && <LoadingRows rows={4} />}
            {!p.script && p.status !== "script_generating" && <p className="py-6 text-center text-xs text-muted">ยังไม่มีสคริปต์ — กด “สร้างสคริปต์”</p>}
            <div className="space-y-3">
              {scenes.map((s, i) => (
                <div key={i} className="rounded-xl border border-line p-3" data-testid="scene">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <div className="grid h-10 w-10 place-items-center rounded-lg bg-surface-2 font-black text-accent-2">{String(i + 1).padStart(2, "0")}</div>
                    <Input className="h-9 max-w-[180px] py-1.5" value={s.title} disabled={locked || !canCreate} onChange={(e) => updateScene(i, { title: e.target.value })} aria-label="ชื่อฉาก" />
                    <Select className="h-9 w-auto py-1.5" value={s.shotType} disabled={locked || !canCreate} onChange={(e) => updateScene(i, { shotType: e.target.value as EditScene["shotType"] })} aria-label="ประเภทฉาก">
                      {SHOT_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </Select>
                    <Input className="h-9 w-20 py-1.5" type="number" min={1} max={30} step={0.5} value={s.durationSec} disabled={locked || !canCreate} onChange={(e) => updateScene(i, { durationSec: Number(e.target.value) })} aria-label="วินาที" />
                    <span className="text-[11px] text-muted">วินาที</span>
                    {canCreate && !locked && scenes.length > 1 && (
                      <Button size="icon" variant="ghost" className="ml-auto size-8" aria-label="ลบฉาก" onClick={() => { setScenes((arr) => arr.filter((_, j) => j !== i)); setDirty(true); }}>
                        <X />
                      </Button>
                    )}
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-[10px] font-bold text-muted">ข้อความบนจอ (Caption)</label>
                      <Textarea className="min-h-16 text-[13px]" value={s.caption} disabled={locked || !canCreate} onChange={(e) => updateScene(i, { caption: e.target.value })} />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-bold text-muted">เสียงพากย์ / ซับไตเติล</label>
                      <Textarea className="min-h-16 text-[13px]" value={s.voiceover} disabled={locked || !canCreate} onChange={(e) => updateScene(i, { voiceover: e.target.value })} />
                    </div>
                  </div>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] text-muted">Visual prompt (พื้นหลังเท่านั้น — ไม่สร้างภาพสินค้า/โลโก้)</summary>
                    <Textarea className="mt-1 min-h-14 text-xs" value={s.visualPrompt} disabled={locked || !canCreate} onChange={(e) => updateScene(i, { visualPrompt: e.target.value })} />
                  </details>
                </div>
              ))}
            </div>
            {canCreate && !locked && p.script && scenes.length < 10 && (
              <Button size="sm" variant="outline" className="mt-3" onClick={() => { setScenes((a) => [...a.slice(0, -1), { durationSec: 4, title: "จุดเด่น", caption: "", voiceover: "", visualPrompt: "clean product stage background, no text", shotType: "benefit" }, ...a.slice(-1)]); setDirty(true); }}>
                <Plus /> เพิ่มฉาก
              </Button>
            )}
            {p.script && (
              <div className="mt-4 grid gap-3 border-t border-line pt-4 text-xs md:grid-cols-2">
                <div>
                  <div className="mb-1 font-bold">แคปชันโพสต์ + Hashtags</div>
                  <p className="whitespace-pre-wrap text-muted">{p.script.caption}</p>
                  <p className="mt-1 text-accent-2">{p.script.hashtags.join(" ")}</p>
                </div>
                <div>
                  <div className="mb-1 font-bold">ข้อเท็จจริงที่อ้างอิง (claims → แหล่งข้อมูล)</div>
                  <ul className="space-y-1 text-muted">
                    {p.script.claims.map((c, i) => (
                      <li key={i}>
                        • {c.text} <code className="rounded bg-surface-2 px-1 text-[10px] text-accent-2">{c.sourceField}</code>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {canCreate && p.status === "awaiting_approval" && (
              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-accent/40 bg-accent/5 p-3">
                <p className="flex-1 text-xs text-muted">ตรวจสอบว่าทุกข้อความตรงกับข้อมูลสินค้า ไม่อ้างผลเกินจริง แล้วอนุมัติเพื่อเริ่มเรนเดอร์</p>
                <Button variant="primary" disabled={dirty} loading={busy === "approve-script"} onClick={() => act("approve-script", () => api(`/api/video-projects/${id}/approve-script`, { method: "POST" }), "อนุมัติสคริปต์แล้ว ส่งเข้าคิวเรนเดอร์")} data-testid="approve-script">
                  <Check /> อนุมัติสคริปต์ & เรนเดอร์
                </Button>
              </div>
            )}
          </Card>
        </div>

        {/* RIGHT: settings & actions */}
        <div className="space-y-4 lg:col-span-2 xl:col-span-1">
          <Card>
            <CardHeader title="Review & Export" actions={<VideoStatusBadge status={p.status} />} />
            <div className="space-y-2">
              {canCreate && ["quality_review", "approved", "exported", "failed", "canceled"].includes(p.status) && p.script && (
                <Button className="w-full" variant="secondary" loading={busy === "render"} onClick={() => act("render", () => api(`/api/video-projects/${id}/render`, { method: "POST" }), "ส่งเข้าคิวเรนเดอร์ใหม่แล้ว")}>
                  <RefreshCw /> {p.status === "failed" || p.status === "canceled" ? "เรนเดอร์อีกครั้ง" : "Re-render"}
                </Button>
              )}
              {p.status === "quality_review" &&
                (canApprove ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="success" loading={busy === "approve"} onClick={() => act("approve", () => api(`/api/video-projects/${id}/approve`, { method: "POST", body: {} }), "อนุมัติวิดีโอแล้ว")} data-testid="approve-video">
                      <Check /> อนุมัติ
                    </Button>
                    <Button variant="outline" onClick={() => setRejectOpen(true)}>
                      <Undo2 /> ส่งกลับแก้
                    </Button>
                  </div>
                ) : (
                  <Note>รอ Approver/Admin ตรวจคุณภาพ (Human review ก่อนเผยแพร่)</Note>
                ))}
              {canExport && ["approved", "exported", "published"].includes(p.status) && (
                <Button className="w-full" variant="primary" loading={busy === "export"} onClick={() => act("export", async () => {
                  const r = await api<{ downloadUrl: string; subtitleUrl: string | null; caption: string | null; affiliateUrl: string | null }>(`/api/video-projects/${id}/export`, { method: "POST" });
                  setExportInfo(r);
                  window.location.assign(r.downloadUrl);
                }, "เริ่มดาวน์โหลด MP4")} data-testid="export-video">
                  <Download /> Export / ดาวน์โหลด MP4
                </Button>
              )}
              {data.urls.download && !["approved", "exported", "published"].includes(p.status) && (
                <Button asChild className="w-full" variant="outline">
                  <a href={data.urls.download} data-testid="download-draft">
                    <Download /> ดาวน์โหลดไฟล์ร่าง (ยังไม่อนุมัติ)
                  </a>
                </Button>
              )}
              {data.urls.subtitle && (
                <Button asChild className="w-full" variant="ghost" size="sm">
                  <a href={data.urls.subtitle}>
                    <FileText /> ไฟล์ซับไตเติล .srt
                  </a>
                </Button>
              )}
              {canPublish && ["approved", "exported"].includes(p.status) && (
                <Button className="w-full" variant="secondary" onClick={() => setPublishOpen(true)}>
                  <Send /> บันทึกการเผยแพร่
                </Button>
              )}
              {p.status === "published" && (
                <Note>
                  เผยแพร่แล้วทาง <b>{p.publishChannel}</b> เมื่อ {dateTime(p.publishedAt)} {p.publishNote && <>· {p.publishNote}</>}
                </Note>
              )}
              {exportInfo?.caption && (
                <div className="rounded-xl border border-line bg-surface-2 p-3 text-[11px]">
                  <div className="mb-1 font-bold">แคปชันสำหรับโพสต์</div>
                  <p className="whitespace-pre-wrap text-muted">{exportInfo.caption}</p>
                  {exportInfo.affiliateUrl && <p className="mt-1 break-all text-accent-2">{exportInfo.affiliateUrl}</p>}
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => navigator.clipboard.writeText(`${exportInfo.caption}\n${exportInfo.affiliateUrl ?? ""}`).then(() => toast.success("คัดลอกแล้ว"))}>
                    คัดลอก
                  </Button>
                </div>
              )}
              <p className="text-[11px] text-muted">Auto-post ใช้ได้เฉพาะช่องทางที่เชื่อม API ที่ได้รับอนุญาต — ปัจจุบันใช้ Manual Export</p>
            </div>
          </Card>

          <Card>
            <CardHeader title="ค่าใช้จ่ายโดยประมาณ" actions={<Badge tone={session.aiMode === "live" ? "green" : "muted"}>{session.aiMode === "live" ? "Live AI" : "Demo"}</Badge>} />
            <ul className="space-y-1 text-xs">
              {data.estimate.lines.map((l) => (
                <li key={l.label} className="flex justify-between gap-2">
                  <span className="text-muted">{l.label}</span>
                  <span className="font-bold">{usd(l.usd)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex justify-between border-t border-line pt-2 text-sm font-bold">
              <span>รวม (ประมาณการ)</span>
              <span>{usd(data.estimate.totalUsd)}</span>
            </div>
            <div className="mt-1 text-[11px] text-muted">ใช้จริงแล้ว {usd(Number(p.actualCostUsd))} · ตรวจงบก่อนส่งเข้าคิวทุกครั้ง</div>
          </Card>

          <CreativeSettings bundle={data} templates={templates.data?.items ?? []} disabled={locked || !canCreate} saving={busy === "patch"} onSave={patch} />
        </div>
      </div>

      <RejectDialog open={rejectOpen} onOpenChange={setRejectOpen} onSubmit={(reason) => act("reject", () => api(`/api/video-projects/${id}/reject`, { method: "POST", body: { reason } }), "ส่งกลับแก้ไขแล้ว").then(() => setRejectOpen(false))} />
      <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} onSubmit={(body) => act("publish", () => api(`/api/video-projects/${id}/publish`, { method: "POST", body }), "บันทึกการเผยแพร่แล้ว").then(() => setPublishOpen(false))} />
    </div>
  );
}

function CreativeSettings({ bundle, templates, disabled, saving, onSave }: { bundle: ProjectBundle; templates: TemplateRow[]; disabled: boolean; saving: boolean; onSave: (b: Record<string, unknown>) => void }) {
  const p = bundle.project;
  const initial = React.useMemo(
    () => ({ templateKey: bundle.template?.key ?? "", language: p.language, renderMode: p.renderMode, voice: p.voice, music: p.music, visualStyle: p.visualStyle, subtitles: p.subtitles, disclosure: p.disclosure }),
    [bundle.template?.key, p.language, p.renderMode, p.voice, p.music, p.visualStyle, p.subtitles, p.disclosure],
  );
  const [f, setF] = React.useState(initial);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- reset form when the server copy changes
  React.useEffect(() => setF(initial), [initial]);
  const changed = JSON.stringify(f) !== JSON.stringify(initial);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Card>
      <CardHeader title="Creative Settings" actions={<Badge>AI</Badge>} />
      <FormRow label="Template (มีผลเมื่อสร้างสคริปต์ใหม่)">
        <Select value={f.templateKey} disabled={disabled} onChange={(e) => set("templateKey", e.target.value)}>
          {templates.map((t) => (
            <option key={t.id} value={t.key}>{t.name}</option>
          ))}
        </Select>
      </FormRow>
      <FormRow label="รูปแบบภาพ">
        <Select value={f.visualStyle} disabled={disabled} onChange={(e) => set("visualStyle", e.target.value)}>
          {VISUAL_STYLE_OPTIONS.map((v) => (
            <option key={v.value} value={v.value}>{v.label}</option>
          ))}
        </Select>
      </FormRow>
      <FormRow label="เครื่องมือสร้างวิดีโอ">
        <Select value={f.renderMode} disabled={disabled} onChange={(e) => set("renderMode", e.target.value as "hybrid" | "generative")}>
          <option value="hybrid">Hybrid: AI Image + Motion / FFmpeg</option>
          <option value="generative">AI Video API (Sora)</option>
        </Select>
      </FormRow>
      <div className="grid grid-cols-2 gap-x-2">
        <FormRow label="ภาษา">
          <Select value={f.language} disabled={disabled} onChange={(e) => set("language", e.target.value as "th" | "en")}>
            <option value="th">ไทย</option>
            <option value="en">English</option>
          </Select>
        </FormRow>
        <FormRow label="เพลง">
          <Select value={f.music} disabled={disabled} onChange={(e) => set("music", e.target.value as "none" | "calm" | "upbeat")}>
            <option value="calm">Calm</option>
            <option value="upbeat">Upbeat</option>
            <option value="none">ไม่มี</option>
          </Select>
        </FormRow>
      </div>
      <FormRow label="เสียงพากย์">
        <Select value={f.voice} disabled={disabled} onChange={(e) => set("voice", e.target.value as "none" | "female" | "male")}>
          <option value="none">ไม่มีเสียงพากย์</option>
          <option value="female">AI · ผู้หญิง · เป็นกันเอง</option>
          <option value="male">AI · ผู้ชาย · กระตือรือร้น</option>
        </Select>
      </FormRow>
      <SwitchRow id="cs-subs" title="ใส่ซับไตเติลอัตโนมัติ" description="Thai caption + .srt" checked={f.subtitles} disabled={disabled} onCheckedChange={(v) => set("subtitles", v)} />
      <SwitchRow id="cs-disc" title="แสดง Affiliate Disclosure" description="ประกาศเนื้อหาส่งเสริมการขาย" checked={f.disclosure} disabled={disabled} onCheckedChange={(v) => set("disclosure", v)} />
      <SwitchRow id="cs-review" title="Human Review ก่อนโพสต์" description="บังคับเสมอ — ลดความเสี่ยงข้อมูลผิด / โฆษณาเกินจริง" checked disabled />
      {changed && (
        <Button className="mt-3 w-full" variant="primary" loading={saving} onClick={() => onSave(f)}>
          <Sparkles /> บันทึกการตั้งค่า
        </Button>
      )}
      {p.renderMode === "generative" && <Note className="mt-3">วิดีโอที่สร้างด้วย AI อาจบิดเบือนรูปทรง/ตัวอักษร ต้องตรวจ QA ทุกครั้ง — ภาพสินค้าและข้อความยังเรนเดอร์แบบ deterministic ทับด้านบน</Note>}
    </Card>
  );
}

function RejectDialog({ open, onOpenChange, onSubmit }: { open: boolean; onOpenChange: (v: boolean) => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = React.useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="ส่งกลับแก้ไข" description="ระบุสิ่งที่ต้องแก้ เช่น ข้อความไม่ตรงข้อมูลสินค้า">
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เหตุผล" />
        <Button className="mt-3 w-full" variant="primary" disabled={!reason.trim()} onClick={() => onSubmit(reason)}>
          ส่งกลับ
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function PublishDialog({ open, onOpenChange, onSubmit }: { open: boolean; onOpenChange: (v: boolean) => void; onSubmit: (b: { channel: string; postUrl?: string; note?: string }) => void }) {
  const [channel, setChannel] = React.useState("tiktok");
  const [postUrl, setPostUrl] = React.useState("");
  const [note, setNote] = React.useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="บันทึกการเผยแพร่ (Manual)" description="ระบบยังไม่ Auto-post — โพสต์ไฟล์ที่ส่งออกด้วยตนเอง แล้วบันทึกลิงก์โพสต์เพื่อติดตามผล">
        <FormRow label="ช่องทาง">
          <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
            {["tiktok", "facebook", "instagram", "youtube", "line", "other"].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </FormRow>
        <FormRow label="ลิงก์โพสต์ (ถ้ามี)">
          <Input value={postUrl} onChange={(e) => setPostUrl(e.target.value)} placeholder="https://" />
        </FormRow>
        <FormRow label="หมายเหตุ">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </FormRow>
        <Button className="w-full" variant="primary" onClick={() => onSubmit({ channel, postUrl: postUrl.trim() || undefined, note: note.trim() || undefined })}>
          บันทึก
        </Button>
      </DialogContent>
    </Dialog>
  );
}
