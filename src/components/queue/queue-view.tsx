"use client";
import * as React from "react";
import Link from "next/link";
import { RotateCcw, Ban, ScrollText, Activity, Server } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, StatBubble } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/form";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState, ErrorState, LoadingRows, Progress } from "@/components/ui/states";
import { Table, TableWrap, THead, Th, Td, Tr } from "@/components/ui/table";
import { JobStatusBadge } from "@/components/data-badges";
import { PageHeading } from "@/components/page-heading";
import { useCan } from "@/components/session-context";
import { api, useApi } from "@/lib/client/api";
import { dateTime, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { JOB_TYPES, jobTypeLabel } from "./job-labels";

type Job = {
  id: string;
  type: string;
  status: string;
  priority: number;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  progress: number;
  progressMessage: string | null;
  projectId: string | null;
  projectTitle: string | null;
  createdAt: string;
  updatedAt: string;
  runAt: string;
  finishedAt: string | null;
};
type JobList = { items: Job[]; total: number; page: number; pageSize: number };
type Summary = {
  counts: Record<string, number>;
  lastActivity: string | null;
  oldestQueuedAt: string | null;
  worker: { queueDriver: string; redisConfigured: boolean; inline: boolean; concurrency: number };
};
type JobEvent = { id: string; level: string; message: string; data: Record<string, unknown> | null; createdAt: string };

const FILTERS = [
  { key: "", label: "ทั้งหมด" },
  { key: "queued,running", label: "กำลังดำเนินการ" },
  { key: "failed", label: "Dead-letter / ล้มเหลว" },
  { key: "succeeded", label: "สำเร็จ" },
  { key: "canceled", label: "ยกเลิก" },
];

export function QueueView() {
  const canManage = useCan("jobs:manage");
  const [status, setStatus] = React.useState("");
  const [type, setType] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [eventsFor, setEventsFor] = React.useState<Job | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const qs = new URLSearchParams({ page: String(page), pageSize: "25" });
  if (status) qs.set("status", status);
  if (type) qs.set("type", type);
  const list = useApi<JobList>(`/api/jobs?${qs}`, { refreshMs: 3000 });
  const summary = useApi<Summary>("/api/jobs/summary", { refreshMs: 5000 });

  const act = async (job: Job, action: "retry" | "cancel") => {
    setBusy(job.id + action);
    try {
      await api(`/api/jobs/${job.id}/${action}`, { method: "POST" });
      toast.success(action === "retry" ? "ส่งงานกลับเข้าคิวแล้ว" : "ยกเลิกงานแล้ว");
      await Promise.all([list.reload(), summary.reload()]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const c = summary.data?.counts ?? {};
  const w = summary.data?.worker;
  const lastActivity = summary.data?.lastActivity;
  const stalled = (c.queued ?? 0) > 0 && summary.data?.oldestQueuedAt && now - new Date(summary.data.oldestQueuedAt).getTime() > 5 * 60_000;
  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <div>
      <PageHeading
        title="Job Queue & Worker"
        description="คิวงานถาวรใน PostgreSQL — งานไม่หายเมื่อ Worker รีสตาร์ต มี Retry อัตโนมัติแบบ Backoff และ Dead-letter สำหรับงานที่ล้มเหลวซ้ำ"
        actions={
          <Card className="flex items-center gap-3 px-4 py-3" data-testid="worker-status">
            <span className={cn("size-2.5 rounded-full", stalled ? "bg-warn" : "bg-good")} />
            <div className="text-xs">
              <div className="flex items-center gap-1.5 font-bold">
                <Server className="size-3.5" /> Worker: {w ? (w.inline ? "Inline (dev)" : "Standalone") : "—"} · Queue: {w?.queueDriver ?? "—"}
                {w?.queueDriver === "bullmq" && !w.redisConfigured && <Badge tone="rose">ไม่มี REDIS_URL</Badge>}
              </div>
              <div className="text-muted">
                <Activity className="mr-1 inline size-3" />
                กิจกรรมล่าสุด {lastActivity ? relativeTime(lastActivity) : "ยังไม่มี"}
                {stalled && <b className="ml-1 text-warn">· มีงานค้างคิว &gt; 5 นาที ตรวจสอบว่า Worker ทำงานอยู่</b>}
              </div>
            </div>
          </Card>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        <StatBubble value={c.queued ?? 0} label="รอคิว" />
        <StatBubble value={c.running ?? 0} label="กำลังทำงาน" />
        <StatBubble value={c.succeeded ?? 0} label="สำเร็จ" />
        <StatBubble value={c.failed ?? 0} label="ล้มเหลว (Dead-letter)" />
        <StatBubble value={c.canceled ?? 0} label="ยกเลิก" />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1" role="tablist" aria-label="กรองตามสถานะ">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={status === f.key}
              onClick={() => {
                setStatus(f.key);
                setPage(1);
              }}
              className={cn("cursor-pointer rounded-lg px-3 py-2 text-xs font-bold text-muted hover:text-fg", status === f.key && "bg-accent text-accent-fg hover:text-accent-fg")}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Select
          aria-label="ประเภทงาน"
          className="w-auto min-w-48"
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(1);
          }}
        >
          <option value="">ทุกประเภทงาน</option>
          {JOB_TYPES.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </Select>
      </div>

      {list.error && <ErrorState error={list.error} onRetry={list.reload} className="mb-4" />}
      {list.loading && !list.data ? (
        <LoadingRows rows={6} />
      ) : !list.data?.items.length ? (
        <EmptyState title="ไม่มีงานในคิวตามตัวกรองนี้" description="งานจะปรากฏเมื่อสร้างสคริปต์ เรนเดอร์วิดีโอ วิเคราะห์สินค้า หรือรันกฎอัตโนมัติ" />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <Th>งาน</Th>
                <Th>สถานะ</Th>
                <Th className="w-56">ความคืบหน้า</Th>
                <Th className="text-right">ครั้งที่</Th>
                <Th>สร้างเมื่อ</Th>
                <Th>ข้อผิดพลาดล่าสุด</Th>
                <Th className="text-right">จัดการ</Th>
              </tr>
            </THead>
            <tbody>
              {list.data.items.map((j) => (
                <Tr key={j.id} data-testid="job-row">
                  <Td>
                    <div className="font-bold">{jobTypeLabel(j.type)}</div>
                    {j.projectId ? (
                      <Link href={`/studio/${j.projectId}`} className="text-[11px] text-accent-2 hover:underline">
                        {j.projectTitle ?? "โปรเจกต์วิดีโอ"}
                      </Link>
                    ) : (
                      <div className="font-mono text-[10px] text-muted">{j.id.slice(0, 8)}</div>
                    )}
                  </Td>
                  <Td>
                    <JobStatusBadge status={j.status} />
                    {j.status === "queued" && new Date(j.runAt).getTime() > now && (
                      <div className="mt-1 text-[10px] text-muted">ลองใหม่ {relativeTime(j.runAt)}</div>
                    )}
                  </Td>
                  <Td>
                    <Progress value={j.status === "succeeded" ? 100 : j.progress} />
                    <div className="mt-1 truncate text-[10px] text-muted">{j.progressMessage ?? "—"}</div>
                  </Td>
                  <Td className="text-right tabular-nums">
                    {j.attempts}/{j.maxAttempts}
                  </Td>
                  <Td className="whitespace-nowrap text-muted">{dateTime(j.createdAt)}</Td>
                  <Td className="max-w-64">
                    {j.lastError ? (
                      <span className="line-clamp-2 text-danger" title={j.lastError}>
                        {j.lastError}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEventsFor(j)} aria-label="ดูเหตุการณ์">
                        <ScrollText /> Log
                      </Button>
                      {canManage && (j.status === "failed" || j.status === "canceled") && (
                        <Button size="sm" variant="outline" loading={busy === j.id + "retry"} onClick={() => act(j, "retry")}>
                          <RotateCcw /> ลองใหม่
                        </Button>
                      )}
                      {canManage && (j.status === "queued" || j.status === "running") && (
                        <Button size="sm" variant="outline" loading={busy === j.id + "cancel"} onClick={() => act(j, "cancel")}>
                          <Ban /> ยกเลิก
                        </Button>
                      )}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}

      {list.data && list.data.total > list.data.pageSize && (
        <div className="mt-3 flex items-center justify-end gap-2 text-xs text-muted">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ก่อนหน้า
          </Button>
          หน้า {page}/{totalPages}
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            ถัดไป
          </Button>
        </div>
      )}

      <Dialog open={!!eventsFor} onOpenChange={(o) => !o && setEventsFor(null)}>
        {eventsFor && (
          <DialogContent title={`Log: ${jobTypeLabel(eventsFor.type)}`} description={`Job ${eventsFor.id}`} wide>
            <JobEvents jobId={eventsFor.id} />
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function JobEvents({ jobId }: { jobId: string }) {
  const r = useApi<{ job: Job & { payload: Record<string, unknown>; result: Record<string, unknown> | null }; events: JobEvent[] }>(`/api/jobs/${jobId}`, { refreshMs: 3000 });
  if (r.error) return <ErrorState error={r.error} onRetry={r.reload} />;
  if (!r.data) return <LoadingRows rows={4} />;
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <CardHeader title="Payload / Result" className="mb-2" />
        <pre className="max-h-48 overflow-auto rounded-lg bg-surface-2 p-3 text-[11px]">{JSON.stringify({ payload: r.data.job.payload, result: r.data.job.result }, null, 2)}</pre>
      </Card>
      <ol className="space-y-2">
        {r.data.events.map((e) => (
          <li key={e.id} className="flex gap-3 border-b border-line pb-2 text-xs last:border-0">
            <Badge tone={e.level === "error" ? "rose" : e.level === "warn" ? "orange" : "muted"}>{e.level}</Badge>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{e.message}</div>
              {e.data && <div className="truncate font-mono text-[10px] text-muted">{JSON.stringify(e.data)}</div>}
            </div>
            <span className="whitespace-nowrap text-muted">{dateTime(e.createdAt)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
