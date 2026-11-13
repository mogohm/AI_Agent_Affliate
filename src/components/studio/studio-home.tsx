"use client";
import * as React from "react";
import Link from "next/link";
import { Clapperboard, Plus } from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, LoadingRows } from "@/components/ui/states";
import { VideoStatusBadge, OriginBadge } from "@/components/data-badges";
import { useCan } from "@/components/session-context";
import { useApi } from "@/lib/client/api";
import { relativeTime } from "@/lib/format";
import { NewProjectPanel } from "./new-project-panel";
import type { ProjectListItem } from "./types";

const STEPS = ["สินค้า", "AI Analysis", "Script", "Storyboard", "Image", "Voiceover", "Render", "Preview", "Export"];

export function StudioHome({ initialOfferId, openNew }: { initialOfferId?: string; openNew?: boolean }) {
  const canCreate = useCan("video:create");
  const [showNew, setShowNew] = React.useState(!!(openNew || initialOfferId));
  const list = useApi<{ items: ProjectListItem[]; total: number }>("/api/video-projects?pageSize=30", { refreshMs: 5000 });

  return (
    <div>
      <PageHeading
        title="AI Video Studio"
        description="สินค้า → สคริปต์ → ภาพ / วิดีโอ → เสียงพากย์ → ตรวจสอบ → ส่งออก"
        actions={
          canCreate && !showNew ? (
            <Button variant="primary" onClick={() => setShowNew(true)}>
              <Plus /> โปรเจกต์ใหม่
            </Button>
          ) : (
            <Badge>9:16 · Video Marketing</Badge>
          )
        }
      />
      <div className="mb-5 flex flex-wrap gap-1.5">
        {STEPS.map((s, i) => (
          <span key={s} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[11px] font-bold text-muted">
            <span className="text-accent-2">{String(i + 1).padStart(2, "0")}</span> {s}
          </span>
        ))}
      </div>
      <div className={showNew && canCreate ? "grid gap-4 xl:grid-cols-[minmax(0,460px)_1fr]" : ""}>
        {showNew && canCreate && <NewProjectPanel initialOfferId={initialOfferId} onCreated={list.reload} />}
        <Card>
          <CardHeader title="โปรเจกต์วิดีโอล่าสุด" description={`${list.data?.total ?? 0} โปรเจกต์ · อัปเดตอัตโนมัติ`} actions={<Button asChild variant="outline" size="sm"><Link href="/library">Content Library ↗</Link></Button>} />
          {list.loading && !list.data ? (
            <LoadingRows rows={5} />
          ) : list.error ? (
            <ErrorState error={list.error} onRetry={list.reload} />
          ) : !list.data?.items.length ? (
            <EmptyState icon={<Clapperboard />} title="ยังไม่มีโปรเจกต์วิดีโอ" description="เลือกสินค้าเพื่อเริ่มสร้างวิดีโอแนวตั้งสำหรับ Affiliate" action={canCreate && <Button variant="primary" onClick={() => setShowNew(true)}>เริ่มสร้างวิดีโอ</Button>} />
          ) : (
            <div className="divide-y divide-line">
              {list.data.items.map((p) => (
                <Link key={p.id} href={`/studio/${p.id}`} className="flex items-center gap-3 py-3 hover:bg-surface-2/50" data-testid="project-row">
                  <div className="grid h-[60px] w-[34px] shrink-0 place-items-center overflow-hidden rounded-md bg-hero text-xs">
                    {/* eslint-disable-next-line @next/next/no-img-element -- authenticated /api/files thumbnails */}
                    {p.thumbnailUrl ? <img src={p.thumbnailUrl} alt="" className="h-full w-full object-cover" /> : "▶"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-bold">{p.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                      <span>{p.durationSec}s · {p.language.toUpperCase()} · {p.renderMode === "hybrid" ? "Hybrid" : "Generative"}</span>
                      <OriginBadge origin={p.productOrigin} />
                      <span>{relativeTime(p.updatedAt)}</span>
                    </div>
                  </div>
                  <VideoStatusBadge status={p.status} />
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
