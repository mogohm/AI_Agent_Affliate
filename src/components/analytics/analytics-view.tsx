"use client";
import * as React from "react";
import Link from "next/link";
import { Upload, Table2, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, KpiCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState, ErrorState, LoadingRows, Note, Skeleton } from "@/components/ui/states";
import { Table, TableWrap, THead, Th, Td, Tr } from "@/components/ui/table";
import { OriginBadge, PlatformLabel } from "@/components/data-badges";
import { PageHeading } from "@/components/page-heading";
import { useCan } from "@/components/session-context";
import { useApi } from "@/lib/client/api";
import { dateTime, num, pct, thb, usd } from "@/lib/format";
import { ClicksChart, CommissionTrendChart, CostChart, VizStyle, type TrendPoint } from "./charts";
import { AnalyticsImport } from "./import-dialog";

type Sums = { pending: number; approved: number; paid: number; reversed: number; orders: number; gmv: number };
type Summary = {
  period: { days: number; fromDate: string };
  kpis: {
    clicks: number;
    orders: number;
    reversedOrders: number;
    gmv: number;
    conversionRate: number | null;
    commission: { pending: number; approved: number; paid: number; reversed: number };
    validatedCommission: number;
    aiCostUsd: number;
    aiCostEstimatedUsd: number;
    aiCostThb: number;
    netRevenueThb: number;
    roi: number | null;
    fxThbPerUsd: number;
  };
  trend: TrendPoint[];
  provenance: { origins: string[]; includeDemo: boolean };
  hasRealData: boolean;
  includeDemo: boolean;
};
type Commissions = { byPlatform: (Sums & { platform: string; clicks: number })[] };
type Performance = {
  byProduct: (Sums & { product_ref: string | null; title: string | null; category: string | null; platform: string; product_id: string | null })[];
  byCategory: (Sums & { category: string })[];
  byContent: (Sums & { sub_id: string; project_id: string | null; project_title: string | null; cost_usd: number })[];
};
type Costs = { byOperation: { provider: string; model: string | null; operation: string; usd: number; n: number; estimated: boolean }[]; byDay: { d: string; usd: number }[]; producedVideos: number; costPerVideoUsd: number | null; fxThbPerUsd: number };
type ImportRun = { id: string; kind: string; status: string; fileName: string | null; totalRows: number; inserted: number; updated: number; failed: number; createdAt: string };

export function AnalyticsView() {
  const canImport = useCan("analytics:import");
  const [period, setPeriod] = React.useState("30");
  const [marketplace, setMarketplace] = React.useState("");
  const [demo, setDemo] = React.useState<"auto" | "true" | "false">("auto");
  const [importOpen, setImportOpen] = React.useState(false);
  const [tableView, setTableView] = React.useState(false);

  const qs = new URLSearchParams({ period, includeDemo: demo });
  if (marketplace) qs.set("marketplace", marketplace);
  const summary = useApi<Summary>(`/api/analytics/summary?${qs}`);
  const commissions = useApi<Commissions>(`/api/analytics/commissions?${qs}`);
  const perf = useApi<Performance>(`/api/analytics/performance?${qs}`);
  const costs = useApi<Costs>(`/api/analytics/costs?${qs}`);
  const imports = useApi<{ items: ImportRun[] }>("/api/analytics/import");

  const reloadAll = () => Promise.all([summary.reload(), commissions.reload(), perf.reload(), costs.reload(), imports.reload()]);
  const s = summary.data;
  const k = s?.kpis;
  const includeDemo = s?.includeDemo ?? false;
  const empty = s && k && k.clicks === 0 && k.orders === 0 && k.commission.reversed === 0;

  return (
    <div>
      <VizStyle />
      <PageHeading
        title="Revenue & Performance"
        description="เชื่อมค่าคอมจากรายงานจริงกับคอนเทนต์เพื่อวัดผลตอบแทนต่อคลิป — แยกสถานะ Pending / Approved / Paid / Reversed เสมอ"
        actions={
          canImport && (
            <Button variant="primary" onClick={() => setImportOpen(true)}>
              <Upload /> นำเข้ารายงาน CSV
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="ตัวกรอง">
        <Select aria-label="ช่วงเวลา" className="w-auto" value={period} onChange={(e) => setPeriod(e.target.value)}>
          <option value="7">7 วันล่าสุด</option>
          <option value="30">30 วันล่าสุด</option>
          <option value="90">90 วันล่าสุด</option>
        </Select>
        <Select aria-label="Marketplace" className="w-auto" value={marketplace} onChange={(e) => setMarketplace(e.target.value)}>
          <option value="">ทุกแพลตฟอร์ม</option>
          <option value="shopee">Shopee</option>
          <option value="lazada">Lazada</option>
        </Select>
        <label className="flex items-center gap-2 rounded-[11px] border border-line bg-surface px-3 py-2 text-xs font-semibold">
          <Switch checked={includeDemo} onCheckedChange={(v) => setDemo(v ? "true" : "false")} aria-label="รวมข้อมูล DEMO" />
          รวมข้อมูล DEMO
        </label>
        {s && (
          <span className="flex items-center gap-1 text-[11px] text-muted">
            แหล่งข้อมูล: {s.provenance.origins.length ? s.provenance.origins.map((o) => <OriginBadge key={o} origin={o} />) : "—"} · ตั้งแต่ {s.period.fromDate} (เวลาไทย)
          </span>
        )}
      </div>

      {s && includeDemo && (
        <Note tone="warn" className="mb-4">
          {s.hasRealData ? (
            <>กำลังแสดง <b>ข้อมูลจริงรวมกับข้อมูล DEMO</b> — ปิดสวิตช์ “รวมข้อมูล DEMO” เพื่อดูเฉพาะรายงานจริง</>
          ) : (
            <>ยังไม่มีรายงานจริง ตัวเลขด้านล่างเป็น <b>ข้อมูลจำลอง (DEMO)</b> สำหรับทดสอบ UI เท่านั้น — นำเข้ารายงาน Conversion/Click จาก Affiliate Dashboard เพื่อดูผลจริง</>
          )}
        </Note>
      )}

      {summary.error && <ErrorState error={summary.error} onRetry={summary.reload} className="mb-4" />}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {!k ? (
          Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28" />)
        ) : (
          <>
            <KpiCard label="Clicks" value={num(k.clicks)} hint={k.conversionRate !== null ? `Conversion ${pct(k.conversionRate * 100, 2)}` : "ยังไม่มีข้อมูลคลิก"} tone="muted" />
            <KpiCard label="Orders (Attributed, ไม่รวมยกเลิก)" value={num(k.orders)} hint={`GMV ${thb(k.gmv)} · ยกเลิก ${num(k.reversedOrders)}`} tone="muted" />
            <KpiCard label="ค่าคอม Validated (Approved + Paid)" value={thb(k.validatedCommission)} hint={`Approved ${thb(k.commission.approved)} · Paid ${thb(k.commission.paid)}`} />
            <KpiCard label="ค่าคอมรอตรวจสอบ (Pending)" value={thb(k.commission.pending)} hint="ยังไม่ยืนยัน อาจถูกยกเลิกได้" tone="warn" />
            <KpiCard label="ค่าคอมถูกยกเลิก (Reversed)" value={thb(k.commission.reversed)} hint="คืนเงิน / ยกเลิก / ไม่ผ่านการตรวจสอบ" tone="muted" />
            <KpiCard
              label="ต้นทุน AI"
              value={thb(k.aiCostThb)}
              hint={`${usd(k.aiCostUsd)} × ${k.fxThbPerUsd} ฿/$${k.aiCostEstimatedUsd > 0 ? " · บางส่วนเป็นค่าประมาณ" : ""}`}
              tone="muted"
            />
            <KpiCard label="รายได้สุทธิ (Validated − ต้นทุน AI)" value={thb(k.netRevenueThb)} hint="ไม่รวม Pending" tone={k.netRevenueThb >= 0 ? "good" : "warn"} />
            <KpiCard label="Content ROI" value={k.roi === null ? "—" : `${k.roi.toFixed(1)}×`} hint={k.roi === null ? "ยังไม่มีต้นทุน AI ในช่วงนี้" : "Validated ÷ ต้นทุน AI"} tone="muted" />
          </>
        )}
      </div>

      {empty ? (
        <EmptyState
          title="ยังไม่มีข้อมูลในช่วงเวลานี้"
          description="นำเข้ารายงาน Conversion และ Click จาก Shopee/Lazada Affiliate หรือรอการเชื่อมต่อ Report API เมื่อได้รับสิทธิ์"
          action={canImport && <Button variant="primary" onClick={() => setImportOpen(true)}>นำเข้ารายงาน</Button>}
        />
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
            <Card>
              <CardHeader
                title="ค่าคอมมิชชันรายวัน"
                description="แยก Validated และ Pending (บาท) · Reversed ดูได้ใน Tooltip / ตาราง"
                actions={
                  <Button size="sm" variant="ghost" onClick={() => setTableView((v) => !v)} aria-pressed={tableView}>
                    {tableView ? <BarChart3 /> : <Table2 />} {tableView ? "กราฟ" : "ตาราง"}
                  </Button>
                }
              />
              {!s ? (
                <Skeleton className="h-56" />
              ) : tableView ? (
                <TrendTable data={s.trend} />
              ) : (
                <>
                  <CommissionTrendChart data={s.trend} />
                  <h3 className="mt-4 mb-1 text-xs font-bold">Clicks รายวัน</h3>
                  <ClicksChart data={s.trend} />
                </>
              )}
            </Card>
            <Card>
              <CardHeader title="รายได้ตามแพลตฟอร์ม" description="Shopee / Lazada" />
              {!commissions.data ? (
                <LoadingRows rows={2} />
              ) : !commissions.data.byPlatform.length ? (
                <p className="text-xs text-muted">ไม่มีข้อมูล</p>
              ) : (
                <div className="space-y-3">
                  {commissions.data.byPlatform.map((p) => (
                    <div key={p.platform} className="rounded-xl border border-line bg-surface-2 p-3 text-xs">
                      <div className="mb-2 flex items-center justify-between">
                        <PlatformLabel platform={p.platform} />
                        <span className="text-muted">
                          {num(p.clicks)} คลิก · {num(p.orders)} ออเดอร์
                        </span>
                      </div>
                      <StatusRow s={p} />
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader title="รายได้ตามสินค้า (Top 20)" description="จับคู่ Product ID ในรายงานกับ Offer ในระบบ" />
              <BreakdownTable
                loading={!perf.data}
                rows={(perf.data?.byProduct ?? []).map((r) => ({
                  key: `${r.platform}-${r.product_ref}`,
                  label: r.product_id ? (
                    <Link href={`/products/${r.product_id}`} className="hover:underline">
                      {r.title}
                    </Link>
                  ) : (
                    <span className="text-muted">{r.product_ref ?? "ไม่ระบุสินค้า"} (ไม่พบในระบบ)</span>
                  ),
                  sub: r.category ?? r.platform,
                  s: r,
                }))}
              />
            </Card>
            <Card>
              <CardHeader title="รายได้ตามหมวดหมู่" />
              <BreakdownTable loading={!perf.data} rows={(perf.data?.byCategory ?? []).map((r) => ({ key: r.category, label: r.category, s: r }))} />
            </Card>
          </div>

          <Card className="mt-4">
            <CardHeader title="ผลตอบแทนต่อคอนเทนต์ (Sub-ID)" description="Sub-ID ในรายงาน ↔ Affiliate link ↔ วิดีโอ" />
            <Note className="mb-3">
              <b>ข้อจำกัดของ Attribution:</b> ระบบนับเฉพาะออเดอร์ที่รายงานของแพลตฟอร์มระบุ Sub-ID ตรงกับลิงก์ของวิดีโอ — ออเดอร์ที่ไม่มี Sub-ID, ข้ามอุปกรณ์ หรือเกินหน้าต่างเวลา Attribution ของแพลตฟอร์มจะไม่ถูกนับ
            </Note>
            {!perf.data ? (
              <LoadingRows rows={3} />
            ) : !perf.data.byContent.length ? (
              <p className="text-xs text-muted">ยังไม่มีออเดอร์ที่มี Sub-ID ในช่วงนี้</p>
            ) : (
              <TableWrap className="rounded-xl">
                <Table className="min-w-[640px]">
                  <THead>
                    <tr>
                      <Th>Sub-ID</Th>
                      <Th>วิดีโอ</Th>
                      <Th className="text-right">ออเดอร์</Th>
                      <Th className="text-right">Validated</Th>
                      <Th className="text-right">Pending</Th>
                      <Th className="text-right">ต้นทุนคลิป</Th>
                      <Th className="text-right">ROI</Th>
                    </tr>
                  </THead>
                  <tbody>
                    {perf.data.byContent.map((r) => {
                      const validated = r.approved + r.paid;
                      const costThb = r.cost_usd * (costs.data?.fxThbPerUsd ?? 36);
                      return (
                        <Tr key={r.sub_id}>
                          <Td className="font-mono">{r.sub_id}</Td>
                          <Td>
                            {r.project_id ? (
                              <Link href={`/studio/${r.project_id}`} className="text-accent-2 hover:underline">
                                {r.project_title}
                              </Link>
                            ) : (
                              <span className="text-muted">ไม่พบวิดีโอที่ผูกกับ Sub-ID นี้</span>
                            )}
                          </Td>
                          <Td className="text-right">{num(r.orders)}</Td>
                          <Td className="text-right font-bold text-good">{thb(validated, 2)}</Td>
                          <Td className="text-right">{thb(r.pending, 2)}</Td>
                          <Td className="text-right">{r.project_id ? thb(costThb, 2) : "—"}</Td>
                          <Td className="text-right">{costThb > 0 ? `${(validated / costThb).toFixed(1)}×` : "—"}</Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </Table>
              </TableWrap>
            )}
          </Card>
        </>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.45fr_1fr]">
        <Card>
          <CardHeader
            title="ต้นทุน AI"
            description={costs.data ? `วิดีโอที่ผลิตในช่วงนี้ ${costs.data.producedVideos} คลิป · ต้นทุนเฉลี่ย ${costs.data.costPerVideoUsd === null ? "—" : usd(costs.data.costPerVideoUsd)}/คลิป` : undefined}
          />
          {!costs.data ? (
            <LoadingRows rows={3} />
          ) : !costs.data.byOperation.length ? (
            <p className="text-xs text-muted">ยังไม่มีค่าใช้จ่าย AI ในช่วงนี้ (Demo mode ไม่มีค่าใช้จ่าย)</p>
          ) : (
            <>
              <CostChart data={costs.data.byDay} />
              <ul className="mt-3 space-y-1 text-xs">
                {costs.data.byOperation.map((o) => (
                  <li key={`${o.provider}-${o.model}-${o.operation}`} className="flex justify-between border-b border-line py-1">
                    <span>
                      {o.provider} · {o.operation} {o.model && <span className="text-muted">({o.model})</span>} {o.estimated && <Badge tone="orange">ประมาณการ</Badge>}
                    </span>
                    <span className="tabular-nums">
                      {usd(o.usd)} · {o.n} ครั้ง
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
        <Card>
          <CardHeader title="ประวัติการนำเข้ารายงาน" />
          {!imports.data ? (
            <LoadingRows rows={2} />
          ) : !imports.data.items.length ? (
            <p className="text-xs text-muted">ยังไม่เคยนำเข้ารายงาน</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {imports.data.items.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 border-b border-line pb-2">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{r.fileName ?? (r.kind === "orders" ? "Orders" : "Clicks")}</div>
                    <div className="text-muted">
                      {r.kind} · {dateTime(r.createdAt)} · +{r.inserted} / ~{r.updated} / ✕{r.failed}
                    </div>
                  </div>
                  <Badge tone={r.status === "completed" ? "green" : r.status === "failed" ? "rose" : "orange"}>{r.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent title="นำเข้ารายงาน Affiliate (CSV)" description="Conversion / Orders หรือ Click report" wide>
          <AnalyticsImport onDone={reloadAll} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusRow({ s }: { s: Sums }) {
  return (
    <div className="grid grid-cols-4 gap-2 text-[11px]">
      <div>
        <div className="text-muted">Pending</div>
        <b>{thb(s.pending)}</b>
      </div>
      <div>
        <div className="text-muted">Approved</div>
        <b>{thb(s.approved)}</b>
      </div>
      <div>
        <div className="text-muted">Paid</div>
        <b className="text-good">{thb(s.paid)}</b>
      </div>
      <div>
        <div className="text-muted">Reversed</div>
        <b className="text-danger">{thb(s.reversed)}</b>
      </div>
    </div>
  );
}

function BreakdownTable({ rows, loading }: { loading: boolean; rows: { key: string; label: React.ReactNode; sub?: string; s: Sums }[] }) {
  if (loading) return <LoadingRows rows={3} />;
  if (!rows.length) return <p className="text-xs text-muted">ไม่มีข้อมูล</p>;
  return (
    <TableWrap className="rounded-xl">
      <Table className="min-w-[520px]">
        <THead>
          <tr>
            <Th>รายการ</Th>
            <Th className="text-right">ออเดอร์</Th>
            <Th className="text-right">Validated</Th>
            <Th className="text-right">Pending</Th>
            <Th className="text-right">Reversed</Th>
          </tr>
        </THead>
        <tbody>
          {rows.map((r) => (
            <Tr key={r.key}>
              <Td>
                <div className="font-semibold">{r.label}</div>
                {r.sub && <div className="text-[10px] text-muted">{r.sub}</div>}
              </Td>
              <Td className="text-right">{num(r.s.orders)}</Td>
              <Td className="text-right font-bold text-good">{thb(r.s.approved + r.s.paid, 2)}</Td>
              <Td className="text-right">{thb(r.s.pending, 2)}</Td>
              <Td className="text-right text-danger">{thb(r.s.reversed, 2)}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}

function TrendTable({ data }: { data: TrendPoint[] }) {
  return (
    <TableWrap className="max-h-80 rounded-xl">
      <Table className="min-w-[520px]">
        <THead>
          <tr>
            <Th>วันที่</Th>
            <Th className="text-right">Clicks</Th>
            <Th className="text-right">Orders</Th>
            <Th className="text-right">Validated</Th>
            <Th className="text-right">Pending</Th>
            <Th className="text-right">Reversed</Th>
          </tr>
        </THead>
        <tbody>
          {[...data].reverse().map((d) => (
            <Tr key={d.date}>
              <Td>{d.date}</Td>
              <Td className="text-right">{num(d.clicks)}</Td>
              <Td className="text-right">{num(d.orders)}</Td>
              <Td className="text-right">{thb(d.approved, 2)}</Td>
              <Td className="text-right">{thb(d.pending, 2)}</Td>
              <Td className="text-right">{thb(d.reversed, 2)}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}
