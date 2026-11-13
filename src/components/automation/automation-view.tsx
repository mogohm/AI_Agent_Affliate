"use client";
import * as React from "react";
import Link from "next/link";
import { Download, Brain, PenLine, Film, CheckCircle2, Plus, Play, FlaskConical, Pencil, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState, ErrorState, LoadingRows, Note, Progress, Skeleton } from "@/components/ui/states";
import { Table, TableWrap, THead, Th, Td, Tr } from "@/components/ui/table";
import { JobStatusBadge, OriginBadge, PlatformLabel } from "@/components/data-badges";
import { PageHeading } from "@/components/page-heading";
import { useCan } from "@/components/session-context";
import { jobTypeLabel } from "@/components/queue/job-labels";
import { api, useApi } from "@/lib/client/api";
import { dateTime, relativeTime, thb, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RuleForm } from "./rule-form";
import type { Overview, Rule, RunResult, RunRow } from "./types";

const RUN_TONE: Record<string, "green" | "orange" | "rose" | "muted"> = { succeeded: "green", partial: "orange", failed: "rose", skipped: "muted" };
const RUN_LABEL: Record<string, string> = { succeeded: "สำเร็จ", partial: "สำเร็จบางส่วน", failed: "ถูกบล็อก/ล้มเหลว", skipped: "ข้าม" };

export function AutomationView() {
  const canManage = useCan("automation:manage");
  const overview = useApi<Overview>("/api/automation/overview", { refreshMs: 10_000 });
  const rules = useApi<{ items: Rule[] }>("/api/automation/rules");
  const runs = useApi<{ items: RunRow[] }>("/api/automation/runs?limit=15");
  const queue = useApi<{ items: { id: string; type: string; status: string; progress: number; progressMessage: string | null; projectTitle: string | null; createdAt: string }[] }>(
    "/api/jobs?pageSize=6",
    { refreshMs: 4000 },
  );
  const [editing, setEditing] = React.useState<Rule | "new" | null>(null);
  const [result, setResult] = React.useState<{ rule: Rule; r: RunResult } | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<Rule | null>(null);

  const refreshAll = () => Promise.all([overview.reload(), rules.reload(), runs.reload(), queue.reload()]);

  const execute = async (rule: Rule, dry: boolean) => {
    setBusy(rule.id + (dry ? "dry" : "run"));
    try {
      const r = await api<RunResult>(`/api/automation/rules/${rule.id}/${dry ? "dry-run" : "run"}`, { method: "POST" });
      setResult({ rule, r });
      if (!dry) {
        if (r.status === "succeeded" || r.status === "partial") toast.success(r.message);
        else toast.warning(r.message);
      }
      await refreshAll();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (rule: Rule, enabled: boolean) => {
    try {
      await api(`/api/automation/rules/${rule.id}`, { method: "PATCH", body: { enabled } });
      toast.success(enabled ? `เปิดใช้งาน "${rule.name}"` : `ปิด "${rule.name}"`);
      await rules.reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const remove = async (rule: Rule) => {
    try {
      await api(`/api/automation/rules/${rule.id}`, { method: "DELETE" });
      toast.success("ลบกฎแล้ว");
      setConfirmDelete(null);
      await refreshAll();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const p = overview.data?.pipeline;
  const steps = [
    { icon: Download, title: "1. Import", sub: "API / Feed / CSV", value: p?.imported, unit: "สินค้า", href: "/products" },
    { icon: Brain, title: "2. AI Screen", sub: "หมวดหมู่ / Score", value: p?.highOpportunity, unit: `น่าสนใจ จาก ${p?.scored ?? 0} ที่ให้คะแนน`, href: "/products?sort=score" },
    { icon: PenLine, title: "3. Creative", sub: "Script / Storyboard", value: p?.creative, unit: "โปรเจกต์", href: "/studio" },
    { icon: Film, title: "4. Render", sub: "Image / Video / TTS", value: p?.rendering, unit: "กำลังเรนเดอร์", href: "/queue" },
    { icon: CheckCircle2, title: "5. Review", sub: "Approve / Export", value: p?.review, unit: `รอตรวจ · อนุมัติ ${p?.approved ?? 0}`, href: "/library" },
  ];
  const b = overview.data?.budget;

  return (
    <div>
      <PageHeading
        title="Automation Factory"
        description="กำหนดกฎและลำดับงานเพื่อเปลี่ยนสินค้าที่ผ่านเกณฑ์ให้เป็นคอนเทนต์อย่างมีการควบคุม — มีโควตา งบประมาณ และ Human approval ทุกขั้น"
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setEditing("new")} disabled={!overview.data}>
              <Plus /> เพิ่มกฎอัตโนมัติ
            </Button>
          )
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-2.5 md:grid-cols-5" data-testid="pipeline">
        {steps.map((s) => (
          <Link key={s.title} href={s.href} className="rounded-2xl border border-line bg-surface px-3 py-4 text-center transition hover:border-accent">
            <s.icon className="mx-auto mb-2 size-7 text-accent-2" />
            <strong className="block text-xs">{s.title}</strong>
            <small className="block text-[10px] text-muted">{s.sub}</small>
            <div className="mt-2 text-xl font-extrabold">{s.value ?? <Skeleton className="mx-auto h-6 w-8" />}</div>
            <small className="block text-[10px] text-muted">{s.unit}</small>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
        <Card>
          <CardHeader title="กฎการคัดเลือกสินค้า" description="Rules Engine · Dry-run ก่อนรันจริงเพื่อดูสินค้าที่จะถูกเลือกและค่าใช้จ่าย" actions={<Badge tone="green">● Rules Engine</Badge>} />
          {rules.error && <ErrorState error={rules.error} onRetry={rules.reload} />}
          {rules.loading && !rules.data ? (
            <LoadingRows rows={3} />
          ) : !rules.data?.items.length ? (
            <EmptyState
              title="ยังไม่มีกฎอัตโนมัติ"
              description="สร้างกฎเพื่อคัดสินค้าตามค่าคอม/คะแนน แล้วสร้างวิดีโอร่างตามโควตารายวัน"
              action={canManage && <Button variant="primary" onClick={() => setEditing("new")}>สร้างกฎแรก</Button>}
            />
          ) : (
            <div className="divide-y divide-line">
              {rules.data.items.map((r) => (
                <RuleCard
                  key={r.id}
                  rule={r}
                  overview={overview.data}
                  canManage={canManage}
                  busy={busy}
                  onToggle={(v) => toggle(r, v)}
                  onDry={() => execute(r, true)}
                  onRun={() => execute(r, false)}
                  onEdit={() => setEditing(r)}
                  onDelete={() => setConfirmDelete(r)}
                />
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="งบประมาณ AI" description={overview.data?.aiMode === "live" ? "Live AI — ตรวจงบก่อนส่งงานทุกครั้ง" : "Demo mode — ไม่มีค่าใช้จ่าย API"} actions={<Wallet className="size-5 text-muted" />} />
            {b ? (
              <div className="space-y-3 text-xs">
                <BudgetBar label="วันนี้" spent={b.spentTodayUsd} limit={b.limits.dailyUsd} />
                <BudgetBar label="เดือนนี้" spent={b.spentMonthUsd} limit={b.limits.monthlyUsd} />
                <div className="text-muted">
                  เพดานต่อคลิป {usd(b.limits.perVideoUsd)} · วิดีโอที่สร้างวันนี้ {overview.data?.projectsToday ?? 0}
                </div>
              </div>
            ) : (
              <LoadingRows rows={2} />
            )}
          </Card>
          <Card>
            <CardHeader title="Production Queue" description="งานล่าสุดจาก Worker" actions={<Link href="/queue" className="text-xs text-accent-2 hover:underline">ดูทั้งหมด ↗</Link>} />
            {!queue.data ? (
              <LoadingRows rows={3} />
            ) : !queue.data.items.length ? (
              <p className="text-xs text-muted">ยังไม่มีงานในคิว</p>
            ) : (
              <div className="grid gap-2.5">
                {queue.data.items.map((j) => (
                  <div key={j.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-3">
                    <div className="min-w-0 flex-1">
                      <strong className="block truncate text-xs">{j.projectTitle ?? jobTypeLabel(j.type)}</strong>
                      <p className="mt-0.5 text-[11px] text-muted">
                        {jobTypeLabel(j.type)} · {relativeTime(j.createdAt)}
                      </p>
                      {j.status === "running" && <Progress value={j.progress} className="mt-1.5" />}
                    </div>
                    <JobStatusBadge status={j.status} />
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader title="ประวัติการรัน" description="ทุกการรัน (รวม Dry-run และตามตารางเวลา) ถูกบันทึกเพื่อตรวจสอบย้อนหลัง" />
        {runs.error && <ErrorState error={runs.error} onRetry={runs.reload} />}
        {!runs.data ? (
          <LoadingRows rows={3} />
        ) : !runs.data.items.length ? (
          <p className="text-xs text-muted">ยังไม่มีประวัติการรัน</p>
        ) : (
          <TableWrap className="rounded-xl">
            <Table className="min-w-[640px]">
              <THead>
                <tr>
                  <Th>เวลา</Th>
                  <Th>กฎ</Th>
                  <Th>ประเภท</Th>
                  <Th>สถานะ</Th>
                  <Th className="text-right">ผ่านเกณฑ์</Th>
                  <Th className="text-right">สร้างวิดีโอ</Th>
                  <Th>รายละเอียด</Th>
                </tr>
              </THead>
              <tbody>
                {runs.data.items.map((r) => (
                  <Tr key={r.id}>
                    <Td className="whitespace-nowrap text-muted">{dateTime(r.createdAt)}</Td>
                    <Td className="font-semibold">{r.ruleName ?? "—"}</Td>
                    <Td>{r.dryRun ? <Badge tone="blue">Dry-run</Badge> : r.trigger === "schedule" ? <Badge>ตามเวลา</Badge> : <Badge tone="muted">Manual</Badge>}</Td>
                    <Td>
                      <Badge tone={RUN_TONE[r.status] ?? "muted"}>{RUN_LABEL[r.status] ?? r.status}</Badge>
                    </Td>
                    <Td className="text-right">{r.matched}</Td>
                    <Td className="text-right">{r.createdProjects}</Td>
                    <Td className="max-w-80 text-muted">{r.message}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && overview.data && (
          <DialogContent title={editing === "new" ? "เพิ่มกฎอัตโนมัติ" : `แก้ไขกฎ: ${editing.name}`} description="กำหนดเงื่อนไขคัดเลือกสินค้าและการผลิต" wide>
            <RuleForm
              rule={editing === "new" ? null : editing}
              overview={overview.data}
              onCancel={() => setEditing(null)}
              onSaved={async () => {
                setEditing(null);
                await refreshAll();
              }}
            />
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={!!result} onOpenChange={(o) => !o && setResult(null)}>
        {result && (
          <DialogContent title={`${result.r.dryRun ? "Dry-run" : "ผลการรัน"}: ${result.rule.name}`} description={result.r.message} wide>
            <RunResultView r={result.r} />
            {result.r.dryRun && canManage && result.r.status === "succeeded" && result.r.planned.length > 0 && (
              <div className="mt-4 flex justify-end">
                <Button variant="primary" loading={busy === result.rule.id + "run"} onClick={() => execute(result.rule, false)}>
                  <Play /> รันจริง ({result.r.planned.length} วิดีโอ)
                </Button>
              </div>
            )}
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        {confirmDelete && (
          <DialogContent title="ลบกฎอัตโนมัติ?" description={`"${confirmDelete.name}" และประวัติการรันของกฎนี้จะถูกลบ (วิดีโอที่สร้างแล้วยังอยู่)`}>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>
                ยกเลิก
              </Button>
              <Button variant="danger" onClick={() => remove(confirmDelete)}>
                ลบกฎ
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function BudgetBar({ label, spent, limit }: { label: string; spent: number; limit: number }) {
  const pct = limit > 0 ? (spent / limit) * 100 : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between">
        <span className="font-semibold">{label}</span>
        <span className={cn(pct >= 90 ? "text-danger" : "text-muted")}>
          {usd(spent)} / {usd(limit)}
        </span>
      </div>
      <Progress value={pct} />
    </div>
  );
}

function conditionSummary(rule: Rule, overview?: Overview | null): string[] {
  const c = rule.conditions;
  const out: string[] = [];
  if (c.minCommissionAmount != null) out.push(`ค่าคอม ≥ ${thb(c.minCommissionAmount)}/ออเดอร์`);
  if (c.minCommissionRate != null) out.push(`อัตรา ≥ ${c.minCommissionRate}%`);
  if (c.minScore != null) out.push(`Score ≥ ${c.minScore}`);
  if (c.minConfidence != null) out.push(`ความเชื่อมั่น ≥ ${c.minConfidence}`);
  if (c.marketplaces?.length) out.push(c.marketplaces.map((m) => (m === "shopee" ? "Shopee" : "Lazada")).join("/"));
  if (c.categoryIds?.length) out.push(c.categoryIds.map((id) => overview?.categories.find((x) => x.id === id)?.name ?? "หมวด").join(", "));
  if (c.excludeAlreadyProduced) out.push("ข้ามสินค้าที่มีวิดีโอแล้ว");
  if (c.requireAuthorizedImage) out.push("ต้องมีภาพที่ยืนยันสิทธิ์");
  return out;
}

function RuleCard({
  rule,
  overview,
  canManage,
  busy,
  onToggle,
  onDry,
  onRun,
  onEdit,
  onDelete,
}: {
  rule: Rule;
  overview: Overview | null;
  canManage: boolean;
  busy: string | null;
  onToggle: (v: boolean) => void;
  onDry: () => void;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const a = rule.actions;
  const tpl = overview?.templates.find((t) => t.key === a.templateKey)?.name ?? a.templateKey;
  return (
    <div className="py-4 first:pt-0 last:pb-0" data-testid="rule-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <strong className="text-[13.5px]">{rule.name}</strong>
          <p className="mt-1 text-[11px] text-muted">{conditionSummary(rule, overview).join(" · ") || "ไม่มีเงื่อนไข (ทุกสินค้า)"}</p>
          <p className="mt-1 text-[11px] text-muted">
            {tpl} · {a.language === "th" ? "ไทย" : "English"} · {a.renderMode === "hybrid" ? "Hybrid" : "Generative"} · {a.videosPerDay} วิดีโอ/วัน (วันนี้ {rule.createdToday}) ·{" "}
            {rule.schedule === "daily" ? `ทุกวัน ${rule.scheduleTime} น.` : "รันด้วยตนเอง"}
            {a.maxCostPerVideoUsd != null && ` · ≤ ${usd(a.maxCostPerVideoUsd)}/คลิป`}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {a.autoGenerateScript && <Badge tone="blue">Auto script</Badge>}
            {a.autoRender && <Badge tone="blue">Auto render หลังอนุมัติ</Badge>}
            <Badge tone="green">Human approval ก่อนเผยแพร่</Badge>
            {rule.lastRunAt && <Badge tone="muted">รันล่าสุด {relativeTime(rule.lastRunAt)}</Badge>}
          </div>
        </div>
        <Switch checked={rule.enabled} disabled={!canManage} onCheckedChange={onToggle} aria-label={`เปิด/ปิด ${rule.name}`} />
      </div>
      {canManage && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" loading={busy === rule.id + "dry"} onClick={onDry}>
            <FlaskConical /> Dry-run
          </Button>
          <Button size="sm" variant="primary" loading={busy === rule.id + "run"} onClick={onRun}>
            <Play /> รันตอนนี้
          </Button>
          <Button size="sm" variant="ghost" onClick={onEdit}>
            <Pencil /> แก้ไข
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete}>
            <Trash2 /> ลบ
          </Button>
        </div>
      )}
    </div>
  );
}

function RunResultView({ r }: { r: RunResult }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Mini label="ผ่านเกณฑ์" value={r.matched} />
        <Mini label="โควตาคงเหลือวันนี้" value={r.quotaRemaining} />
        <Mini label={r.dryRun ? "จะสร้าง" : "สร้างแล้ว"} value={r.dryRun ? r.planned.length : r.createdProjectIds.length} />
        <Mini label="ค่าใช้จ่ายประมาณการ" value={r.aiMode === "demo" ? "$0 (Demo)" : usd(r.estimateTotalUsd)} />
      </div>
      {r.budget && !r.budget.ok && <ErrorState error={r.budget.reason ?? "เกินงบประมาณ"} />}
      {r.errors.length > 0 && <ErrorState error={r.errors.map((e) => e.error).join(" · ")} />}
      {r.planned.length > 0 ? (
        <TableWrap className="rounded-xl">
          <Table className="min-w-[620px]">
            <THead>
              <tr>
                <Th>#</Th>
                <Th>สินค้า</Th>
                <Th>แพลตฟอร์ม</Th>
                <Th className="text-right">คอม/ออเดอร์</Th>
                <Th className="text-right">Score</Th>
                <Th>เหตุผล</Th>
              </tr>
            </THead>
            <tbody>
              {r.planned.map((p, i) => (
                <Tr key={p.offerId}>
                  <Td>{i + 1}</Td>
                  <Td>
                    <div className="font-semibold">{p.title}</div>
                    <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted">
                      {p.categoryName ?? "ไม่ระบุหมวด"} <OriginBadge origin={p.dataOrigin} />
                    </div>
                  </Td>
                  <Td>
                    <PlatformLabel platform={p.platform} />
                  </Td>
                  <Td className="text-right font-bold text-good">{thb(p.estCommission, 2)}</Td>
                  <Td className="text-right text-accent-2">{p.score ?? "—"}</Td>
                  <Td className="text-[11px] text-muted">{p.reasons.join(" · ")}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      ) : (
        <Note>ไม่มีสินค้าที่จะถูกสร้างในรอบนี้</Note>
      )}
      {r.rejected.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer font-semibold text-muted">สินค้าที่ไม่ผ่านเกณฑ์ ({r.rejected.length})</summary>
          <ul className="mt-2 space-y-1">
            {r.rejected.map((x) => (
              <li key={x.offerId} className="flex justify-between gap-3 border-b border-line py-1">
                <span className="truncate">{x.title}</span>
                <span className="shrink-0 text-muted">{x.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {r.dryRun && <Note>Dry-run ไม่สร้างวิดีโอและไม่เรียก API ที่มีค่าใช้จ่าย · การเผยแพร่ต้องได้รับอนุมัติจาก Approver เสมอ</Note>}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-3 py-2.5">
      <div className="text-[10px] text-muted">{label}</div>
      <div className="text-lg font-extrabold">{value}</div>
    </div>
  );
}
