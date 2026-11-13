"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BrainCircuit, ChevronLeft, ChevronRight, Filter, ListPlus, RefreshCw, Sparkles, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatBubble } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { EmptyState, ErrorState, LoadingRows } from "@/components/ui/states";
import { Table, TableWrap, Td, Th, THead, Tr } from "@/components/ui/table";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { OriginBadge, PlatformLabel } from "@/components/data-badges";
import { PageHeading } from "@/components/page-heading";
import { useCan } from "@/components/session-context";
import { api, useApi } from "@/lib/client/api";
import { freshness } from "@/lib/core/commission";
import { num, pct, relativeTime, thb } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ManualAddDialog } from "./manual-add-dialog";
import { ProductThumb } from "./product-thumb";
import type { Category, OfferListResponse, OfferRow, Shortlist } from "./types";

const SORT_OPTIONS = [
  { v: "commission_amount", l: "ค่าคอมต่อออเดอร์ ↓" },
  { v: "commission_rate", l: "อัตราค่าคอม % ↓" },
  { v: "score", l: "Opportunity Score ↓" },
  { v: "price_asc", l: "ราคา ↑" },
  { v: "price_desc", l: "ราคา ↓" },
  { v: "newest", l: "เพิ่มล่าสุด" },
  { v: "freshness", l: "ข้อมูลใหม่ล่าสุด" },
];

const FILTER_KEYS = ["search", "marketplace", "categoryId", "origin", "minPrice", "maxPrice", "minRate", "minCommission", "minScore", "shortlistId", "duplicatesOnly", "needsReview", "sort", "page"] as const;

function FreshDot({ at }: { at: string }) {
  const f = freshness(at);
  const cls = f === "fresh" ? "bg-good" : f === "aging" ? "bg-warn" : "bg-danger";
  const label = f === "fresh" ? "ข้อมูลใหม่ (≤7 วัน)" : f === "aging" ? "ข้อมูล 7–30 วัน" : f === "stale" ? "ข้อมูลเก่า >30 วัน" : "ไม่ทราบ";
  return <span title={`${label} · ${relativeTime(at)}`} className={cn("inline-block size-2 rounded-full", cls)} />;
}

export function ProductExplorer() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const canWrite = useCan("products:write");
  const canVideo = useCan("video:create");

  const params = React.useMemo(() => {
    const p = new URLSearchParams();
    for (const k of FILTER_KEYS) {
      const v = sp.get(k);
      if (v) p.set(k, v);
    }
    p.set("pageSize", "25");
    return p;
  }, [sp]);
  const list = useApi<OfferListResponse>(`/api/products?${params.toString()}`);
  const cats = useApi<{ items: Category[] }>("/api/categories");
  const lists = useApi<{ items: Shortlist[] }>("/api/shortlists");

  const [search, setSearch] = React.useState(sp.get("search") ?? "");
  const [selected, setSelected] = React.useState<Map<string, OfferRow>>(new Map());
  const [showMore, setShowMore] = React.useState(() => FILTER_KEYS.slice(4, 12).some((k) => sp.get(k)));
  const [busy, setBusy] = React.useState<string | null>(null);
  const [shortlistOpen, setShortlistOpen] = React.useState(false);

  const setParam = React.useCallback(
    (updates: Record<string, string | null>) => {
      const p = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === "") p.delete(k);
        else p.set(k, v);
      }
      if (!("page" in updates)) p.delete("page");
      router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    },
    [sp, router, pathname],
  );

  // debounce search → URL
  React.useEffect(() => {
    const cur = sp.get("search") ?? "";
    if (search === cur) return;
    const t = setTimeout(() => setParam({ search: search.trim() || null }), 350);
    return () => clearTimeout(t);
  }, [search, sp, setParam]);

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const page = list.data?.page ?? 1;
  const pages = Math.max(1, Math.ceil(total / 25));
  const allOnPage = items.length > 0 && items.every((i) => selected.has(i.offer_id));
  const hasDemo = items.some((i) => i.data_origin === "demo" || i.commission_origin === "demo");

  const toggle = (row: OfferRow) =>
    setSelected((prev) => {
      const n = new Map(prev);
      if (n.has(row.offer_id)) n.delete(row.offer_id);
      else n.set(row.offer_id, row);
      return n;
    });
  const toggleAll = () =>
    setSelected((prev) => {
      const n = new Map(prev);
      if (allOnPage) items.forEach((i) => n.delete(i.offer_id));
      else items.forEach((i) => n.set(i.offer_id, i));
      return n;
    });

  const bulkVideo = async () => {
    if (!selected.size) return toast.error("เลือกสินค้าอย่างน้อย 1 รายการก่อน");
    setBusy("video");
    try {
      const r = await api<{ projects: { id: string }[] }>("/api/video-projects/batch", { method: "POST", body: { offerIds: [...selected.keys()] } });
      toast.success(`สร้างโปรเจกต์วิดีโอ ${r.projects.length} รายการแล้ว`);
      setSelected(new Map());
      router.push("/library");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const analyze = async (all: boolean) => {
    setBusy("analyze");
    try {
      const productIds = [...new Set([...selected.values()].map((s) => s.product_id))];
      await api("/api/products/analyze", { method: "POST", body: all ? { all: true } : { productIds } });
      toast.success("ส่งงานวิเคราะห์เข้าคิวแล้ว — ผลจะอัปเดตเมื่อ Worker ทำงานเสร็จ", { action: { label: "ดูคิว", onClick: () => router.push("/queue") } });
      setTimeout(() => list.reload(), 4000);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const addToShortlist = async (listId: string | null, newName?: string) => {
    try {
      let id = listId;
      if (!id) {
        const created = await api<{ id: string }>("/api/shortlists", { method: "POST", body: { name: newName } });
        id = created.id;
      }
      const productIds = [...new Set([...selected.values()].map((s) => s.product_id))];
      const r = await api<{ added: number }>(`/api/shortlists/${id}/items`, { method: "POST", body: { productIds } });
      toast.success(`เพิ่ม ${r.added} สินค้าเข้า Shortlist แล้ว`);
      setShortlistOpen(false);
      lists.reload();
      list.reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const activeFilterCount = FILTER_KEYS.slice(1, 12).filter((k) => sp.get(k)).length;

  return (
    <div>
      <PageHeading
        title="Product Intelligence"
        description="รวมสินค้า Shopee + Lazada คัดกรอง จัดหมวดหมู่ และจัดลำดับค่าคอมอย่างมีเหตุผล"
        actions={<StatBubble value={num(total)} label="สินค้าที่ตรงตัวกรอง" />}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Input className="w-full sm:w-72" placeholder="⌕ ค้นหาชื่อสินค้า / แบรนด์ / ร้าน / หมวดหมู่" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="ค้นหา" />
          <Select className="w-auto" aria-label="แพลตฟอร์ม" value={sp.get("marketplace") ?? ""} onChange={(e) => setParam({ marketplace: e.target.value })}>
            <option value="">ทุกแพลตฟอร์ม</option>
            <option value="shopee">Shopee</option>
            <option value="lazada">Lazada</option>
          </Select>
          <Select className="w-auto" aria-label="หมวดหมู่" value={sp.get("categoryId") ?? ""} onChange={(e) => setParam({ categoryId: e.target.value })}>
            <option value="">ทุกหมวดหมู่</option>
            {cats.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.products})
              </option>
            ))}
          </Select>
          <Select className="w-auto" aria-label="เรียงตาม" value={sp.get("sort") ?? "commission_amount"} onChange={(e) => setParam({ sort: e.target.value === "commission_amount" ? null : e.target.value })}>
            {SORT_OPTIONS.map((o) => (
              <option key={o.v} value={o.v}>
                {o.l}
              </option>
            ))}
          </Select>
          <Button size="sm" variant={showMore ? "outline" : "ghost"} onClick={() => setShowMore((v) => !v)}>
            <Filter /> ตัวกรองเพิ่มเติม{activeFilterCount ? ` (${activeFilterCount})` : ""}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canWrite && (
            <>
              <Button asChild size="sm" variant="outline">
                <Link href="/products/import">
                  <Upload /> นำเข้า CSV / Feed
                </Link>
              </Button>
              <ManualAddDialog categories={cats.data?.items ?? []} onCreated={() => list.reload()} />
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => list.reload()} aria-label="รีเฟรช">
            <RefreshCw />
          </Button>
        </div>
      </div>

      {showMore && (
        <div className="mb-4 grid gap-2.5 rounded-2xl border border-line bg-surface p-3.5 sm:grid-cols-3 lg:grid-cols-6">
          <NumFilter label="ราคาต่ำสุด ฿" k="minPrice" sp={sp} setParam={setParam} />
          <NumFilter label="ราคาสูงสุด ฿" k="maxPrice" sp={sp} setParam={setParam} />
          <NumFilter label="ค่าคอมขั้นต่ำ %" k="minRate" sp={sp} setParam={setParam} />
          <NumFilter label="คอม/ออเดอร์ขั้นต่ำ ฿" k="minCommission" sp={sp} setParam={setParam} />
          <NumFilter label="Score ขั้นต่ำ" k="minScore" sp={sp} setParam={setParam} />
          <label className="text-[11px] font-bold text-muted">
            แหล่งข้อมูล
            <Select className="mt-1" value={sp.get("origin") ?? ""} onChange={(e) => setParam({ origin: e.target.value })}>
              <option value="">ทั้งหมด</option>
              <option value="api">API</option>
              <option value="feed">Feed</option>
              <option value="csv">CSV</option>
              <option value="manual">Manual</option>
              <option value="demo">DEMO</option>
            </Select>
          </label>
          <label className="text-[11px] font-bold text-muted">
            Shortlist
            <Select className="mt-1" value={sp.get("shortlistId") ?? ""} onChange={(e) => setParam({ shortlistId: e.target.value })}>
              <option value="">ทั้งหมด</option>
              {lists.data?.items.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.count})
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-2 self-end pb-2.5 text-xs">
            <input type="checkbox" checked={!!sp.get("needsReview")} onChange={(e) => setParam({ needsReview: e.target.checked ? "1" : null })} /> รอตรวจสอบ / ข้อมูลไม่พอ
          </label>
          <label className="flex items-center gap-2 self-end pb-2.5 text-xs">
            <input type="checkbox" checked={!!sp.get("duplicatesOnly")} onChange={(e) => setParam({ duplicatesOnly: e.target.checked ? "1" : null })} /> อาจซ้ำ (รอยืนยัน)
          </label>
          <div className="flex items-end pb-1 sm:col-span-3 lg:col-span-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSearch("");
                router.replace(pathname);
              }}
            >
              <X /> ล้างตัวกรอง
            </Button>
          </div>
        </div>
      )}

      {selected.size > 0 && (
        <div className="sticky top-[84px] z-20 mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-accent/50 bg-surface-2 px-3.5 py-2.5 shadow-card">
          <b className="text-sm">เลือกแล้ว {selected.size} รายการ</b>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Map())}>
            ล้าง
          </Button>
          <div className="ml-auto flex flex-wrap gap-2">
            {canWrite && (
              <>
                <Button size="sm" variant="outline" onClick={() => setShortlistOpen(true)}>
                  <ListPlus /> เพิ่มเข้า Shortlist
                </Button>
                <Button size="sm" variant="outline" loading={busy === "analyze"} onClick={() => analyze(false)}>
                  <BrainCircuit /> วิเคราะห์ด้วย AI
                </Button>
              </>
            )}
            {canVideo && (
              <Button size="sm" variant="primary" loading={busy === "video"} onClick={bulkVideo}>
                <Sparkles /> สร้างวิดีโอจากที่เลือก {selected.size}
              </Button>
            )}
          </div>
        </div>
      )}

      {list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : list.loading && !list.data ? (
        <LoadingRows rows={8} />
      ) : items.length === 0 ? (
        <EmptyState
          title="ไม่พบสินค้าตามเงื่อนไข"
          description={activeFilterCount || sp.get("search") ? "ลองปรับหรือล้างตัวกรอง" : "เริ่มต้นด้วยการนำเข้า CSV / Product Feed ที่ได้รับอนุญาต หรือเพิ่มสินค้าเอง"}
          action={
            canWrite ? (
              <Button asChild variant="primary" size="sm">
                <Link href="/products/import">
                  <Upload /> นำเข้าสินค้า
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <TableWrap className={cn(list.loading && "opacity-60")}>
          <Table>
            <THead>
              <tr>
                <Th className="w-10">
                  <input type="checkbox" checked={allOnPage} onChange={toggleAll} aria-label="เลือกทั้งหน้า" />
                </Th>
                <Th>สินค้า</Th>
                <Th>แพลตฟอร์ม</Th>
                <Th>หมวดหมู่</Th>
                <Th className="text-right">ราคา</Th>
                <Th className="text-right">คอม %*</Th>
                <Th className="text-right">คอม/ออเดอร์*</Th>
                <Th className="text-right">Score*</Th>
                <Th>ข้อมูล</Th>
                <Th>จัดการ</Th>
              </tr>
            </THead>
            <tbody>
              {items.map((r) => (
                <Tr key={r.offer_id} data-testid="product-row">
                  <Td>
                    <input type="checkbox" checked={selected.has(r.offer_id)} onChange={() => toggle(r)} aria-label={`เลือก ${r.title}`} />
                  </Td>
                  <Td>
                    <div className="flex items-center gap-3">
                      <ProductThumb title={r.title} imageUrl={r.image_url} size={44} />
                      <div className="min-w-0">
                        <Link href={`/products/${r.product_id}`} className="line-clamp-2 max-w-[320px] text-xs font-bold hover:text-accent-2">
                          {r.title}
                        </Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                          <span>{r.shop_name ?? "—"}</span>
                          <span>· {r.external_product_id}</span>
                          {r.shortlisted && <Badge tone="blue" className="px-1.5 py-0.5 text-[10px]">Shortlist</Badge>}
                          {r.duplicate_group_id && <Badge tone="orange" className="px-1.5 py-0.5 text-[10px]" title={r.duplicate_reason ?? ""}>อาจซ้ำ</Badge>}
                        </div>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <PlatformLabel platform={r.platform} />
                  </Td>
                  <Td>
                    {r.category_name ?? <span className="text-muted">ไม่ระบุ</span>}
                    {r.category_source && r.category_source !== "manual" && r.category_source !== "source" && (
                      <div className="text-[10px] text-muted">{r.category_source === "ai" ? "จัดโดย AI" : r.category_source === "rules" ? "จัดอัตโนมัติ" : "mapping"}</div>
                    )}
                  </Td>
                  <Td className="text-right whitespace-nowrap">{thb(r.price)}</Td>
                  <Td className="text-right whitespace-nowrap">
                    {r.rate_total === null ? <span className="text-muted" title="ไม่มีข้อมูลค่าคอม">—</span> : pct(r.rate_total)}
                    {r.rate_is_estimated && <div className="text-[10px] text-warn">ค่าประมาณ</div>}
                  </Td>
                  <Td className="text-right font-extrabold whitespace-nowrap text-good" data-testid="est-commission">
                    {r.est_commission === null ? <span className="font-normal text-muted">—</span> : thb(r.est_commission, 2)}
                    {r.cap_amount !== null && r.est_commission !== null && r.est_commission >= r.cap_amount && (
                      <div className="text-[10px] font-normal text-muted">ติดเพดาน</div>
                    )}
                  </Td>
                  <Td className="text-right font-extrabold whitespace-nowrap text-accent-2">
                    {r.score === null ? <span className="font-normal text-muted">—</span> : `✦ ${Math.round(r.score)}`}
                    {r.score_confidence !== null && (
                      <div className={cn("text-[10px] font-normal", r.needs_review ? "text-warn" : "text-muted")}>
                        {r.needs_review ? "รอตรวจ · " : ""}conf {Math.round((r.score_confidence ?? 0) * 100)}%
                      </div>
                    )}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <FreshDot at={r.fetched_at} />
                      <OriginBadge origin={r.data_origin} />
                    </div>
                  </Td>
                  <Td>
                    {canVideo ? (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/studio?offerId=${r.offer_id}`}>ทำคลิป ↗</Link>
                      </Button>
                    ) : (
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/products/${r.product_id}`}>ดู ↗</Link>
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}

      {total > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>
            แสดง {(page - 1) * 25 + 1}–{Math.min(page * 25, total)} จาก {num(total)} รายการ
          </span>
          <div className="flex items-center gap-2">
            {canWrite && (
              <Button size="sm" variant="ghost" loading={busy === "analyze"} onClick={() => analyze(true)}>
                <BrainCircuit /> วิเคราะห์ใหม่ทั้งหมด
              </Button>
            )}
            <Button size="icon" variant="outline" disabled={page <= 1} onClick={() => setParam({ page: String(page - 1) })} aria-label="หน้าก่อน">
              <ChevronLeft />
            </Button>
            <span>
              หน้า {page}/{pages}
            </span>
            <Button size="icon" variant="outline" disabled={page >= pages} onClick={() => setParam({ page: String(page + 1) })} aria-label="หน้าถัดไป">
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}

      <p className="mt-5 text-[11px] leading-relaxed text-muted">
        *ค่าคอม/ออเดอร์ = min(ราคา × อัตราค่าคอม, เพดาน) จากข้อมูลล่าสุดของแต่ละข้อเสนอ — ยังไม่ใช่รายได้ที่อนุมัติแล้ว. Score คำนวณเฉพาะจากข้อมูลที่มีจริง
        ข้อมูลที่ขาดจะลดค่าความเชื่อมั่น (conf).{" "}
        {hasDemo && <b className="text-warn">รายการที่ติดป้าย DEMO เป็นอัตราค่าคอมและตัวเลขสมมติ ไม่ใช่อัตราจริงของ Shopee/Lazada.</b>} ค่าคอมจริงต้องตรวจสอบเงื่อนไข เพดาน
        และสถานะออเดอร์จากแหล่งที่ได้รับอนุญาต
      </p>

      <Dialog open={shortlistOpen} onOpenChange={setShortlistOpen}>
        <DialogContent title="เพิ่มเข้า Shortlist" description={`${selected.size} รายการที่เลือก`}>
          <ShortlistPicker lists={lists.data?.items ?? []} onPick={addToShortlist} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NumFilter({ label, k, sp, setParam }: { label: string; k: string; sp: URLSearchParams; setParam: (u: Record<string, string | null>) => void }) {
  const [v, setV] = React.useState(sp.get(k) ?? "");
  return (
    <label className="text-[11px] font-bold text-muted">
      {label}
      <Input
        className="mt-1"
        type="number"
        min={0}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => setParam({ [k]: v || null })}
        onKeyDown={(e) => e.key === "Enter" && setParam({ [k]: v || null })}
      />
    </label>
  );
}

function ShortlistPicker({ lists, onPick }: { lists: Shortlist[]; onPick: (id: string | null, name?: string) => void }) {
  const [name, setName] = React.useState("");
  return (
    <div className="space-y-2">
      {lists.map((l) => (
        <button key={l.id} onClick={() => onPick(l.id)} className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-left text-sm hover:border-accent">
          <span>{l.name}</span>
          <span className="text-xs text-muted">{l.count} รายการ</span>
        </button>
      ))}
      <div className="flex gap-2 pt-2">
        <Input placeholder="ชื่อ Shortlist ใหม่" value={name} onChange={(e) => setName(e.target.value)} />
        <Button variant="primary" disabled={!name.trim()} onClick={() => onPick(null, name.trim())}>
          สร้าง + เพิ่ม
        </Button>
      </div>
    </div>
  );
}
