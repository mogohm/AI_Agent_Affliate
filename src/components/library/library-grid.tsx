"use client";
import * as React from "react";
import Link from "next/link";
import { Clapperboard, Download, Search } from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { OriginBadge, PlatformLabel, VideoStatusBadge } from "@/components/data-badges";
import { useCan } from "@/components/session-context";
import { useApi } from "@/lib/client/api";
import { LIBRARY_GROUPS, type LibraryGroup } from "@/lib/labels";
import { relativeTime, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProjectListItem } from "@/components/studio/types";

export function LibraryGrid() {
  const canCreate = useCan("video:create");
  const [group, setGroup] = React.useState<LibraryGroup | "all">("all");
  const [search, setSearch] = React.useState("");
  const [q, setQ] = React.useState("");
  const [page, setPage] = React.useState(1);
  React.useEffect(() => {
    const t = setTimeout(() => {
      setQ(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);
  const params = new URLSearchParams({ page: String(page), pageSize: "24", ...(group !== "all" ? { group } : {}), ...(q ? { search: q } : {}) });
  const { data, error, loading, reload } = useApi<{ items: ProjectListItem[]; total: number; groups: Record<string, number>; pageSize: number }>(`/api/video-projects?${params}`, { refreshMs: 6000 });
  const totalAll = Object.values(data?.groups ?? {}).reduce((a, b) => a + b, 0);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <PageHeading
        title="Content Library & Publishing"
        description="รวมงานทั้งหมด ตรวจร่าง อนุมัติ และส่งออกไฟล์สำหรับเผยแพร่"
        actions={
          canCreate && (
            <Button asChild variant="primary">
              <Link href="/studio?new=1">＋ สร้างคอนเทนต์ใหม่</Link>
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1" role="tablist">
          {[{ key: "all" as const, label: "ทั้งหมด" }, ...LIBRARY_GROUPS].map((g) => {
            const n = g.key === "all" ? totalAll : (data?.groups[g.key] ?? 0);
            return (
              <button
                key={g.key}
                role="tab"
                aria-selected={group === g.key}
                onClick={() => {
                  setGroup(g.key);
                  setPage(1);
                }}
                className={cn("cursor-pointer rounded-lg px-3 py-2 text-xs font-bold text-muted hover:text-fg", group === g.key && "bg-accent text-accent-fg hover:text-accent-fg")}
              >
                {g.label} <span className="opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input className="pl-9" placeholder="ค้นหาคลิป / สินค้า" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="ค้นหาคลิป" />
        </div>
      </div>

      {error && !data ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-80" />
          ))}
        </div>
      ) : !data?.items.length ? (
        <EmptyState icon={<Clapperboard />} title="ยังไม่มีคอนเทนต์ในกลุ่มนี้" description="สร้างวิดีโอจาก AI Video Studio แล้วงานจะปรากฏที่นี่" action={canCreate && <Button asChild variant="primary"><Link href="/studio?new=1">ไปที่ Video Studio</Link></Button>} />
      ) : (
        <>
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
            {data.items.map((p) => (
              <Card key={p.id} className="flex flex-col p-4" data-testid="library-card">
                <Link href={`/studio/${p.id}`} className="relative block aspect-[9/12] overflow-hidden rounded-xl bg-hero">
                  {p.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- authenticated /api/files thumbnails
                    <img src={p.thumbnailUrl} alt={p.title} className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="grid h-full place-items-center text-5xl text-white/80">▶</div>
                  )}
                  <span className="absolute top-2 left-2"><VideoStatusBadge status={p.status} /></span>
                </Link>
                <h3 className="mt-3 line-clamp-2 text-sm font-bold">{p.title}</h3>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                  {p.platform && <PlatformLabel platform={p.platform} />}
                  <span>{p.aspectRatio} · {p.durationSec}s · {p.language.toUpperCase()}</span>
                  <OriginBadge origin={p.productOrigin} />
                </div>
                <div className="mt-1 text-[11px] text-muted">
                  ID {p.id.slice(0, 8)} · {relativeTime(p.updatedAt)} · ต้นทุน {usd(Number(p.actualCostUsd))}
                  {p.publishChannel && <> · โพสต์ที่ {p.publishChannel}</>}
                </div>
                {p.error && <p className="mt-1 line-clamp-2 text-[11px] text-danger">{p.error}</p>}
                <div className="mt-auto flex gap-2 pt-3">
                  <Button asChild size="sm" variant="secondary" className="flex-1">
                    <Link href={`/studio/${p.id}`}>รายละเอียดงาน ↗</Link>
                  </Button>
                  {p.downloadUrl && (
                    <Button asChild size="sm" variant="outline" title="ดาวน์โหลด MP4">
                      <a href={p.downloadUrl} aria-label="ดาวน์โหลด MP4">
                        <Download />
                      </a>
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
          {pages > 1 && (
            <div className="mt-5 flex items-center justify-center gap-2 text-xs">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((x) => x - 1)}>ก่อนหน้า</Button>
              <span className="text-muted">หน้า {page}/{pages}</span>
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((x) => x + 1)}>ถัดไป</Button>
            </div>
          )}
        </>
      )}
      <p className="mt-6 text-[11px] text-muted">ระบบเผยแพร่ต้องตรวจสอบขอบเขต API และเงื่อนไขของแต่ละช่องทางก่อนเปิด Auto Post; ใช้ Manual Export เป็นค่าเริ่มต้นเสมอ ดาวน์โหลดไฟล์ร่างได้เพื่อตรวจ แต่ควรเผยแพร่เฉพาะคลิปที่อนุมัติแล้ว</p>
    </div>
  );
}
