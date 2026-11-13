"use client";
import * as React from "react";
import Link from "next/link";
import { Bot, Coins, Gem, ListChecks, Percent, PlaySquare, Sparkles, Table2, TrendingUp, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, KpiCard, StatBubble } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { OriginBadge } from "@/components/data-badges";
import { ProductThumb } from "@/components/catalog/product-thumb";
import { useCan } from "@/components/session-context";
import { useApi } from "@/lib/client/api";
import { dateOnly, num, pct, thb, usd } from "@/lib/format";
import type { DashboardData } from "@/lib/catalog/dashboard";
import type { Category } from "@/components/catalog/types";
import { CategoryCommissionChart, CommissionTrendChart } from "./charts";

function originNote(origins: string[] | Record<string, number>) {
  const keys = Array.isArray(origins) ? origins : Object.keys(origins);
  if (!keys.length) return "ยังไม่มีข้อมูล";
  if (keys.length === 1 && keys[0] === "demo") return "ข้อมูล DEMO ทั้งหมด";
  if (keys.includes("demo")) return `รวมข้อมูล DEMO · ${keys.filter((k) => k !== "demo").join("/").toUpperCase()}`;
  return `แหล่ง: ${keys.join("/").toUpperCase()}`;
}

export function DashboardView() {
  const canVideo = useCan("video:create");
  const [period, setPeriod] = React.useState("30");
  const [marketplace, setMarketplace] = React.useState("");
  const [categoryId, setCategoryId] = React.useState("");
  const [showTable, setShowTable] = React.useState(false);
  const qs = new URLSearchParams({ period, ...(marketplace && { marketplace }), ...(categoryId && { categoryId }) });
  const { data: d, error, loading, reload } = useApi<DashboardData>(`/api/dashboard?${qs}`, { refreshMs: 60_000 });
  const cats = useApi<{ items: Category[] }>("/api/categories");
  const periodLabel = `${period} วันล่าสุด`;

  return (
    <div>
      <div className="bg-hero hero-rings relative mb-5 flex min-h-[190px] items-center justify-between gap-6 overflow-hidden rounded-[20px] border border-accent/35 p-7">
        <div className="relative z-10">
          <div className="text-[10px] font-extrabold tracking-[2px] opacity-85">SMART AFFILIATE WORKSPACE</div>
          <h2 className="my-2 text-2xl font-bold tracking-tight sm:text-[27px]">ค้นหาสินค้าดี ทำคลิปไว วัดผลเป็น</h2>
          <p className="mb-4 max-w-[630px] text-sm opacity-85">
            จัดอันดับสินค้าที่น่าโปรโมตจากค่าคอมและสัญญาณที่มีข้อมูลจริง แล้วเปลี่ยนเป็นวิดีโอพร้อมเผยแพร่ใน Workflow เดียว
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="primary">
              <Link href="/products">สำรวจสินค้าทำเงิน ↗</Link>
            </Button>
            {canVideo && (
              <Button asChild variant="outline" className="border-white/30 bg-white/10 text-white hover:bg-white/20">
                <Link href="/studio">เข้า Video Studio</Link>
              </Button>
            )}
          </div>
        </div>
        <div className="relative z-10 hidden -rotate-12 text-[83px] drop-shadow-[0_13px_10px_#0a214d88] md:block" aria-hidden>
          🛍️
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2" role="group" aria-label="ตัวกรอง Dashboard">
        <Select className="w-auto" aria-label="ช่วงเวลา" value={period} onChange={(e) => setPeriod(e.target.value)}>
          <option value="7">7 วันล่าสุด</option>
          <option value="30">30 วันล่าสุด</option>
          <option value="90">90 วันล่าสุด</option>
        </Select>
        <Select className="w-auto" aria-label="แพลตฟอร์ม" value={marketplace} onChange={(e) => setMarketplace(e.target.value)}>
          <option value="">ทุกแพลตฟอร์ม</option>
          <option value="shopee">Shopee</option>
          <option value="lazada">Lazada</option>
        </Select>
        <Select className="w-auto" aria-label="หมวดหมู่" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">ทุกหมวดหมู่</option>
          {cats.data?.items.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        {loading && d && <span className="text-xs text-muted">กำลังอัปเดต…</span>}
      </div>

      {error && <ErrorState error={error} onRetry={reload} className="mb-5" />}

      {!d ? (
        !error && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-[130px] rounded-card" />
            ))}
          </div>
        )
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="สินค้าที่ติดตาม" icon={<Gem />} value={num(d.catalog.products)} hint={`${num(d.catalog.offers)} ข้อเสนอ · ${originNote(d.catalog.origins)}`} tone="muted" />
            <KpiCard
              label="สินค้าน่าสนใจ (Score ≥ 70)"
              icon={<Sparkles />}
              value={num(d.scores.high)}
              hint={`${num(d.scores.needsReview)} รายการรอตรวจ/ข้อมูลไม่พอ`}
              tone={d.scores.needsReview ? "warn" : "good"}
            />
            <KpiCard label="อัตราค่าคอมเฉลี่ย*" icon={<Percent />} value={pct(d.catalog.avgRate)} hint={`${num(d.catalog.missingRate)} ข้อเสนอยังไม่มีอัตรา · ${originNote(d.catalog.origins)}`} tone="muted" />
            <KpiCard label="ค่าคอมประมาณการ/ออเดอร์ (เฉลี่ย)*" icon={<Coins />} value={thb(d.catalog.avgEstCommission)} hint={`สูงสุด ${thb(d.catalog.maxEstCommission, 2)} · ไม่ใช่รายได้จริง`} tone="muted" />
            <KpiCard label="วิดีโอที่เรนเดอร์แล้ว" icon={<PlaySquare />} value={num(d.videos.producedInPeriod)} hint={`ใน ${periodLabel}`} tone="muted" />
            <KpiCard
              label="งานในคิว"
              icon={<ListChecks />}
              value={num(d.queue.queued + d.queue.running)}
              hint={`กำลังทำ ${d.queue.running} · ล้มเหลว ${d.queue.failed}`}
              tone={d.queue.failed ? "warn" : "muted"}
            />
            <KpiCard
              label="ค่าใช้จ่าย AI"
              icon={<Bot />}
              value={usd(d.aiCost.usd)}
              hint={`≈ ${thb(d.aiCost.thb, 2)} (${d.aiCost.fxThbPerUsd} ฿/$) · ${d.aiCost.calls} ครั้ง · ${periodLabel}${d.aiCost.isEstimate && d.aiCost.calls ? " · ประมาณการ" : ""}`}
              tone="muted"
            />
            <KpiCard
              label="รายได้ Affiliate (อนุมัติ + จ่ายแล้ว)"
              icon={<Wallet />}
              value={thb(d.revenue.approved + d.revenue.paid)}
              hint={`รอตรวจ ${thb(d.revenue.pending)} · ${periodLabel} · ${originNote(d.revenue.origins)}`}
              tone={d.revenue.origins.includes("demo") ? "warn" : "good"}
            />
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[1.45fr_1fr]">
            <Card>
              <CardHeader
                title="ภาพรวมค่าคอมมิชชัน"
                description={`รายวัน (บาท) จากรายงานออเดอร์ · ${originNote(d.revenue.origins)} · ไม่รวมออเดอร์ที่ถูกยกเลิก (${thb(d.revenue.reversed)})`}
                actions={
                  <>
                    <Badge>{periodLabel}</Badge>
                    <Button size="sm" variant="ghost" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
                      <Table2 /> {showTable ? "กราฟ" : "ตาราง"}
                    </Button>
                  </>
                }
              />
              {d.revenue.orders === 0 ? (
                <EmptyState
                  icon={<TrendingUp />}
                  title="ยังไม่มีข้อมูลรายได้ในช่วงนี้"
                  description="นำเข้ารายงานออเดอร์/ค่าคอมจาก Shopee/Lazada Affiliate ที่หน้า รายได้และวิเคราะห์"
                  className="py-10"
                />
              ) : showTable ? (
                <div className="max-h-[250px] overflow-auto">
                  <Table className="min-w-0">
                    <THead>
                      <tr>
                        <Th>วันที่</Th>
                        <Th className="text-right">อนุมัติ/จ่ายแล้ว</Th>
                        <Th className="text-right">รอตรวจสอบ</Th>
                      </tr>
                    </THead>
                    <tbody>
                      {d.trend.map((t) => (
                        <Tr key={t.day}>
                          <Td>{dateOnly(t.day)}</Td>
                          <Td className="text-right">{thb(t.validated, 2)}</Td>
                          <Td className="text-right">{thb(t.pending, 2)}</Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              ) : (
                <CommissionTrendChart data={d.trend} />
              )}
            </Card>

            <Card>
              <CardHeader
                title="สินค้าเด่น (ค่าคอมต่อออเดอร์)"
                description="เรียงตามค่าคอมประมาณการ = min(ราคา × อัตรา, เพดาน)"
                actions={
                  <Button asChild size="sm" variant="outline">
                    <Link href="/products">ดูทั้งหมด ↗</Link>
                  </Button>
                }
              />
              {d.topProducts.length === 0 ? (
                <EmptyState title="ยังไม่มีสินค้า" description="นำเข้า CSV หรือเพิ่มสินค้าเพื่อเริ่มจัดอันดับ" className="py-10" />
              ) : (
                <div>
                  {d.topProducts.map((p) => (
                    <Link key={p.offer_id} href={`/products/${p.product_id}`} className="flex items-center gap-3 border-b border-line py-3 last:border-0 hover:opacity-85">
                      <ProductThumb title={p.title} imageUrl={p.image_url} size={48} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-bold">{p.title}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                          {p.platform === "shopee" ? "Shopee" : "Lazada"} · {p.category_name ?? "ไม่ระบุ"} <OriginBadge origin={p.commission_origin ?? p.data_origin} />
                        </div>
                      </div>
                      <div className="text-right font-extrabold whitespace-nowrap text-good">
                        {p.est_commission === null ? "—" : thb(p.est_commission, 2)}
                        <div className="text-[11px] font-normal text-muted">/ ออเดอร์*</div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[1.45fr_1fr]">
            <Card>
              <CardHeader title="กระบวนการผลิตคลิป" description="สถานะโปรเจกต์วิดีโอทั้งหมด (ข้อมูลจริงจากระบบ)" actions={<Badge tone="green">Live status</Badge>} />
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <StatBubble value={num((d.videos.pipeline.created ?? 0) + (d.videos.pipeline.awaiting_approval ?? 0))} label="ร่าง / รออนุมัติสคริปต์" />
                <StatBubble
                  value={num(
                    (d.videos.pipeline.script_generating ?? 0) + (d.videos.pipeline.queued_render ?? 0) + (d.videos.pipeline.asset_generation ?? 0) + (d.videos.pipeline.rendering ?? 0),
                  )}
                  label="กำลังสร้าง/เรนเดอร์"
                />
                <StatBubble value={num(d.videos.pipeline.quality_review ?? 0)} label="รอตรวจคุณภาพ" />
                <StatBubble value={num((d.videos.pipeline.approved ?? 0) + (d.videos.pipeline.exported ?? 0) + (d.videos.pipeline.published ?? 0))} label="อนุมัติ/เผยแพร่แล้ว" />
              </div>
              <div className="mt-5">
                <div className="mb-2 text-xs font-bold">ค่าคอมเฉลี่ยต่อออเดอร์ตามหมวดหมู่*</div>
                {d.categories.some((c) => c.avgEst !== null) ? <CategoryCommissionChart data={d.categories} /> : <p className="text-xs text-muted">ยังไม่มีข้อมูลค่าคอม</p>}
              </div>
            </Card>
            <Card>
              <CardHeader title="Insights" description="คำแนะนำที่คำนวณจากกฎบนข้อมูลในระบบ (ไม่ใช่ AI)" actions={<Badge>Rule-based</Badge>} />
              <ul className="space-y-2.5 text-[13px]">
                {d.insights.map((s) => (
                  <li key={s} className="flex gap-2">
                    <span aria-hidden>💡</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
              {canVideo && (
                <Button asChild size="sm" variant="outline" className="mt-4">
                  <Link href="/studio">เข้า Video Studio ↗</Link>
                </Button>
              )}
            </Card>
          </div>

          <p className="mt-5 text-[11px] leading-relaxed text-muted">
            *ค่าคอมประมาณการคำนวณจากอัตราล่าสุดของแต่ละข้อเสนอ ยังไม่ใช่รายได้ที่ได้รับ. รายได้แยกสถานะ รอตรวจ / อนุมัติ / จ่ายแล้ว / ยกเลิก จากรายงานที่นำเข้า.
            {(d.catalog.origins.demo || d.revenue.origins.includes("demo")) && <b className="text-warn"> ตัวเลขที่ติดป้าย DEMO เป็นข้อมูลจำลองสำหรับทดสอบ UI เท่านั้น.</b>}
          </p>
        </>
      )}
    </div>
  );
}
