"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BrainCircuit, ExternalLink, GitMerge, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { FormRow, Select } from "@/components/ui/form";
import { EmptyState, ErrorState, LoadingRows, Note, Progress } from "@/components/ui/states";
import { Table, TableWrap, Td, Th, THead, Tr } from "@/components/ui/table";
import { OriginBadge, PlatformLabel } from "@/components/data-badges";
import { useCan } from "@/components/session-context";
import { api, useApi } from "@/lib/client/api";
import { dateTime, num, pct, relativeTime, thb } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProductDetail as Detail } from "@/lib/catalog/detail";
import { ProductThumb } from "./product-thumb";
import type { Category } from "./types";

// Dates arrive as ISO strings over JSON.
type J<T> = T extends Date ? string : T extends (infer U)[] ? J<U>[] : T extends object ? { [K in keyof T]: J<T[K]> } : T;
type DetailJson = J<Detail>;

const ANALYZER: Record<string, { label: string; tone: "green" | "muted" | "orange" }> = {
  openai: { label: "วิเคราะห์โดย AI (OpenAI)", tone: "green" },
  rules: { label: "ประเมินด้วยกฎ (rule-based — ไม่ใช่ AI)", tone: "muted" },
  demo: { label: "DEMO · ประเมินด้วยกฎจากข้อมูลจำลอง", tone: "orange" },
};
const MISSING_LABEL: Record<string, string> = {
  price: "ราคา",
  commission_rate: "อัตราค่าคอม",
  sold_count: "ยอดขาย",
  rating: "คะแนนรีวิว",
  trend_score: "ข้อมูลเทรนด์/ดีมานด์",
  content_potential: "ศักยภาพคอนเทนต์",
};
const FRESH: Record<string, string> = { fresh: "ใหม่ (≤7 วัน)", aging: "7–30 วัน", stale: "เก่า >30 วัน", unknown: "ไม่ทราบ" };

export function ProductDetailView({ productId }: { productId: string }) {
  const router = useRouter();
  const canWrite = useCan("products:write");
  const canVideo = useCan("video:create");
  const d = useApi<DetailJson>(`/api/products/${productId}`);
  const cats = useApi<{ items: Category[] }>("/api/categories");
  const [busy, setBusy] = React.useState<string | null>(null);

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      await d.reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (d.error) return <ErrorState error={d.error} onRetry={d.reload} />;
  if (!d.data) return <LoadingRows rows={6} />;
  const { product: p, offers, latestScore: s, duplicates, category, shortlists, scoreHistory } = d.data;
  const emoji = p.attributes?.demo_emoji;
  const best = [...offers].sort((a, b) => (b.estCommission ?? -1) - (a.estCommission ?? -1))[0];
  const attrs = Object.entries(p.attributes ?? {}).filter(([k]) => !k.startsWith("demo_") && k !== "trend_score");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/products">← สินค้าทั้งหมด</Link>
        </Button>
        <div className="flex flex-wrap gap-2">
          {canWrite && (
            <Button size="sm" variant="outline" loading={busy === "analyze"} onClick={() => act("analyze", () => api("/api/products/analyze", { method: "POST", body: { productIds: [p.id] } }), "ส่งงานวิเคราะห์เข้าคิวแล้ว")}>
              <BrainCircuit /> วิเคราะห์ใหม่
            </Button>
          )}
          {canVideo && best && (
            <Button asChild size="sm" variant="primary">
              <Link href={`/studio?offerId=${best.id}`}>
                <Sparkles /> สร้างวิดีโอจากสินค้านี้
              </Link>
            </Button>
          )}
        </div>
      </div>

      <div className="bg-hero hero-rings relative flex flex-col gap-5 overflow-hidden rounded-[20px] border border-accent/35 p-6 sm:flex-row sm:items-center">
        <ProductThumb title={p.title} imageUrl={p.imageUrl} emoji={emoji} size={96} className="relative z-10" />
        <div className="relative z-10 min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-extrabold tracking-[2px] opacity-80">
            PRODUCT · {category?.name ?? "ไม่ระบุหมวดหมู่"} {p.brand && `· ${p.brand}`}
          </div>
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">{p.title}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <OriginBadge origin={p.dataOrigin} />
            {shortlists.map((l) => (
              <Badge key={l.id} tone="blue">
                Shortlist: {l.name}
              </Badge>
            ))}
            {p.duplicateGroupId && <Badge tone="orange">อาจซ้ำ ({p.duplicateReason})</Badge>}
          </div>
        </div>
        <div className="relative z-10 grid grid-cols-2 gap-3 text-center sm:w-72">
          <div className="rounded-xl bg-white/10 px-3 py-2.5">
            <div className="text-2xl font-extrabold">{s?.score === null || s?.score === undefined ? "—" : Math.round(s.score)}</div>
            <div className="text-[10px] opacity-80">Opportunity Score*</div>
          </div>
          <div className="rounded-xl bg-white/10 px-3 py-2.5">
            <div className="text-2xl font-extrabold">{best?.estCommission === null || !best ? "—" : thb(best.estCommission, 2)}</div>
            <div className="text-[10px] opacity-80">คอม/ออเดอร์สูงสุด*</div>
          </div>
        </div>
      </div>

      {p.dataOrigin === "demo" && <Note tone="warn">สินค้านี้เป็น <b>ข้อมูลตัวอย่าง (DEMO)</b> — ราคา ค่าคอม ยอดขาย และรีวิวเป็นตัวเลขสมมติ ไม่ใช่ข้อมูลจริงจาก Marketplace</Note>}

      <Card>
        <CardHeader title="ข้อเสนอในแต่ละ Marketplace" description="ค่าคอมคำนวณจาก snapshot ล่าสุดที่มีผล: min(ราคา × อัตรา, เพดาน)" />
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <Th>แพลตฟอร์ม / ร้าน</Th>
                <Th className="text-right">ราคา</Th>
                <Th className="text-right">ค่าคอม</Th>
                <Th className="text-right">คอม/ออเดอร์*</Th>
                <Th className="text-right">รีวิว / ยอดขาย</Th>
                <Th>แหล่งข้อมูล</Th>
                <Th>ลิงก์</Th>
              </tr>
            </THead>
            <tbody>
              {offers.map((o) => (
                <Tr key={o.id}>
                  <Td>
                    <PlatformLabel platform={o.platform} />
                    <div className="mt-0.5 text-[11px] text-muted">
                      {o.shopName ?? o.shopId ?? "—"} · {o.externalProductId}
                      {o.variantName && ` · ${o.variantName}`}
                    </div>
                  </Td>
                  <Td className="text-right">
                    {thb(o.price)}
                    {o.originalPrice && o.originalPrice > o.price && <div className="text-[10px] text-muted line-through">{thb(o.originalPrice)}</div>}
                  </Td>
                  <Td className="text-right">
                    {o.currentCommission ? pct(o.currentCommission.rateTotal) : <span className="text-muted">ไม่มีข้อมูล</span>}
                    {o.currentCommission?.capAmount !== null && o.currentCommission?.capAmount !== undefined && (
                      <div className="text-[10px] text-muted">เพดาน {thb(o.currentCommission.capAmount)}</div>
                    )}
                    {o.currentCommission?.isEstimated && <div className="text-[10px] text-warn">ค่าประมาณ</div>}
                  </Td>
                  <Td className="text-right font-extrabold text-good">
                    {o.estCommission === null ? "—" : thb(o.estCommission, 2)}
                    {o.estCapped && <div className="text-[10px] font-normal text-muted">ติดเพดาน</div>}
                  </Td>
                  <Td className="text-right">
                    {o.rating !== null ? `★ ${o.rating.toFixed(1)}` : "—"} <span className="text-muted">({o.ratingCount ?? "—"})</span>
                    <div className="text-[11px] text-muted">ขายแล้ว {o.soldCount === null ? "ไม่มีข้อมูล" : num(o.soldCount)}</div>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <OriginBadge origin={o.dataOrigin} />
                      <span className="text-[11px] text-muted">{FRESH[o.freshness]}</span>
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted" title={dateTime(o.fetchedAt)}>
                      {o.sourceName ?? "—"} · {relativeTime(o.fetchedAt)}
                    </div>
                  </Td>
                  <Td>
                    <div className="flex flex-col gap-1 text-[11px]">
                      {o.productUrl && (
                        <a href={o.productUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent-2 hover:underline">
                          สินค้า <ExternalLink className="size-3" />
                        </a>
                      )}
                      {o.affiliateUrl && (
                        <a href={o.affiliateUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent-2 hover:underline">
                          Affiliate <ExternalLink className="size-3" />
                        </a>
                      )}
                      {!o.productUrl && !o.affiliateUrl && <span className="text-muted">—</span>}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader
            title="AI Product Intelligence · Opportunity Score"
            description={s ? `เวอร์ชัน ${s.version} · ${dateTime(s.createdAt)}${s.model ? ` · ${s.model}` : ""}` : "ยังไม่มีคะแนน"}
            actions={s && <Badge tone={ANALYZER[s.analyzer]?.tone ?? "muted"}>{ANALYZER[s.analyzer]?.label ?? s.analyzer}</Badge>}
          />
          {!s ? (
            <EmptyState title="ยังไม่ได้วิเคราะห์" className="py-8" />
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-4">
                <div>
                  <div className="text-4xl font-extrabold text-accent-2">{s.score === null ? "—" : Math.round(s.score)}<span className="text-base text-muted">/100</span></div>
                </div>
                <div className="min-w-40 flex-1">
                  <div className="mb-1 flex justify-between text-[11px] text-muted">
                    <span>ความเชื่อมั่นของข้อมูล</span>
                    <span>{Math.round(s.confidence * 100)}%</span>
                  </div>
                  <Progress value={s.confidence * 100} />
                </div>
                {s.needsReview && <Badge tone="orange">ควรตรวจสอบโดยคนก่อนผลิต</Badge>}
              </div>
              <div className="space-y-3">
                {s.components.map((c) => (
                  <div key={c.key}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                      <span className="font-bold">
                        {c.label} <span className="font-normal text-muted">· น้ำหนัก {c.weight}%</span>
                      </span>
                      <span className={cn("font-bold", c.value === null && "font-normal text-muted")}>{c.value === null ? "ไม่มีข้อมูล (ไม่นำมาคิด)" : `${Math.round(c.value * 100)}/100`}</span>
                    </div>
                    <Progress value={c.value === null ? 0 : c.value * 100} className={cn(c.value === null && "opacity-40")} />
                    <div className="mt-1 text-[11px] text-muted">{c.evidence}</div>
                  </div>
                ))}
              </div>
              <p className="mt-4 rounded-xl border border-line bg-surface-2 p-3 text-xs leading-relaxed">{s.explanation}</p>
              {s.missingFields.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-muted">ข้อมูลที่ยังขาด:</span>
                  {s.missingFields.map((m) => (
                    <Badge key={m} tone="muted">
                      {MISSING_LABEL[m] ?? m}
                    </Badge>
                  ))}
                </div>
              )}
              {(s.audience || s.contentAngles.length > 0 || s.riskFlags.length > 0) && (
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div>
                    <div className="mb-1 text-[11px] font-bold text-muted">กลุ่มเป้าหมาย</div>
                    <div className="text-xs">{s.audience ?? "—"}</div>
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-bold text-muted">มุมคอนเทนต์</div>
                    <ul className="list-disc pl-4 text-xs">{s.contentAngles.map((a) => <li key={a}>{a}</li>)}</ul>
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-bold text-muted">ความเสี่ยง</div>
                    <ul className="list-disc pl-4 text-xs text-warn">{s.riskFlags.map((a) => <li key={a}>{a}</li>)}</ul>
                  </div>
                </div>
              )}
              {scoreHistory.length > 1 && (
                <div className="mt-4 text-[11px] text-muted">
                  ประวัติคะแนน: {scoreHistory.map((h) => `${h.score === null ? "—" : Math.round(h.score)} (${h.analyzer})`).join(" ← ")}
                </div>
              )}
            </>
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="ข้อมูลสินค้า" description="ใช้เป็นข้อเท็จจริงอ้างอิงในสคริปต์วิดีโอ" />
            {canWrite ? (
              <div className="grid gap-x-3 sm:grid-cols-2">
                <FormRow label="หมวดหมู่" htmlFor="pd-cat" hint={p.categorySource ? `ที่มา: ${p.categorySource}${p.categoryConfidence ? ` (${Math.round(p.categoryConfidence * 100)}%)` : ""}` : undefined}>
                  <Select
                    id="pd-cat"
                    value={p.categoryId ?? ""}
                    disabled={busy === "cat"}
                    onChange={(e) => act("cat", () => api(`/api/products/${p.id}`, { method: "PATCH", body: { categoryId: e.target.value || null } }), "อัปเดตหมวดหมู่แล้ว")}
                  >
                    <option value="">ไม่ระบุ</option>
                    {cats.data?.items.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </FormRow>
                <FormRow label="สิทธิ์การใช้ภาพในวิดีโอ" htmlFor="pd-rights">
                  <Select
                    id="pd-rights"
                    value={p.imageRights}
                    disabled={busy === "rights"}
                    onChange={(e) => act("rights", () => api(`/api/products/${p.id}`, { method: "PATCH", body: { imageRights: e.target.value } }), "อัปเดตสิทธิ์ภาพแล้ว")}
                  >
                    <option value="unknown">ยังไม่ยืนยันสิทธิ์</option>
                    <option value="authorized">ได้รับอนุญาต</option>
                    <option value="not_allowed">ห้ามใช้</option>
                  </Select>
                </FormRow>
              </div>
            ) : (
              <div className="mb-3 text-xs">
                หมวดหมู่: <b>{category?.name ?? "ไม่ระบุ"}</b> · สิทธิ์ภาพ: <b>{p.imageRights}</b>
              </div>
            )}
            <p className="text-xs leading-relaxed whitespace-pre-line">{p.description ?? <span className="text-muted">ไม่มีรายละเอียด</span>}</p>
            {attrs.length > 0 && (
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                {attrs.map(([k, v]) => (
                  <React.Fragment key={k}>
                    <dt className="text-muted">{k}</dt>
                    <dd>{v}</dd>
                  </React.Fragment>
                ))}
              </dl>
            )}
            {(p.gtin || p.model) && (
              <div className="mt-3 text-[11px] text-muted">
                {p.gtin && `GTIN ${p.gtin}`} {p.model && `· รุ่น ${p.model}`}
              </div>
            )}
          </Card>

          {p.duplicateGroupId && (
            <Card>
              <CardHeader title="สินค้าที่อาจซ้ำกัน" description="จับคู่จากชื่อสินค้าที่คล้ายกัน — ต้องให้คนยืนยันก่อนรวม (ไม่รวมอัตโนมัติ)" />
              {duplicates.length === 0 ? (
                <p className="text-xs text-muted">ไม่มีรายการอื่นในกลุ่มแล้ว</p>
              ) : (
                <div className="space-y-2">
                  {duplicates.map((x) => (
                    <div key={x.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2 p-2.5">
                      <Link href={`/products/${x.id}`} className="min-w-0 flex-1 truncate text-xs font-bold hover:text-accent-2">
                        {x.title}
                      </Link>
                      <OriginBadge origin={x.dataOrigin} />
                      {canWrite && (
                        <Button
                          size="sm"
                          variant="outline"
                          loading={busy === `merge-${x.id}`}
                          onClick={() => {
                            if (confirm("ยืนยันว่าเป็นสินค้าเดียวกัน? ข้อเสนอทั้งหมดจะถูกย้ายมารวมที่สินค้านี้")) {
                              void act(`merge-${x.id}`, () => api(`/api/products/${p.id}/duplicate`, { method: "POST", body: { action: "merge", otherId: x.id } }), "รวมสินค้าแล้ว");
                            }
                          }}
                        >
                          <GitMerge /> รวมเข้าที่นี่
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {canWrite && (
                <Button className="mt-3" size="sm" variant="ghost" loading={busy === "dismiss"} onClick={() => act("dismiss", () => api(`/api/products/${p.id}/duplicate`, { method: "POST", body: { action: "dismiss" } }), "ยืนยันว่าไม่ซ้ำแล้ว")}>
                  <X /> ไม่ใช่สินค้าเดียวกัน
                </Button>
              )}
            </Card>
          )}

          {canWrite && (
            <Button
              variant="ghost"
              size="sm"
              className="text-danger"
              onClick={() => {
                if (!confirm("ลบสินค้านี้ออกจากรายการ? (soft delete — ประวัติยังถูกเก็บไว้)")) return;
                void api(`/api/products/${p.id}`, { method: "DELETE" })
                  .then(() => {
                    toast.success("ลบสินค้าแล้ว");
                    router.push("/products");
                  })
                  .catch((e: Error) => toast.error(e.message));
              }}
            >
              <Trash2 /> ลบสินค้า
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader title="ประวัติค่าคอมมิชชัน (Commission snapshots)" description="บันทึกแบบ immutable — ทุกการเปลี่ยนแปลงเงื่อนไขสร้าง snapshot ใหม่ พร้อมแหล่งที่มา" />
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <Th>ดึงข้อมูลเมื่อ</Th>
                <Th>แพลตฟอร์ม</Th>
                <Th className="text-right">อัตรารวม</Th>
                <Th className="text-right">ผู้ขาย / แพลตฟอร์ม / โบนัส</Th>
                <Th className="text-right">เพดาน / ขั้นต่ำ</Th>
                <Th>ช่วงมีผล</Th>
                <Th>แหล่งอ้างอิง</Th>
              </tr>
            </THead>
            <tbody>
              {offers.flatMap((o) =>
                o.commissionHistory.map((c) => (
                  <Tr key={c.id}>
                    <Td className="whitespace-nowrap">{dateTime(c.fetchedAt)}</Td>
                    <Td>
                      <PlatformLabel platform={o.platform} />
                    </Td>
                    <Td className="text-right font-bold">
                      {pct(c.rateTotal)} {c.isEstimated && <Badge tone="orange" className="ml-1 px-1.5 py-0.5 text-[10px]">ประมาณ</Badge>}
                    </Td>
                    <Td className="text-right">
                      {[c.sellerRate, c.platformRate, c.bonusRate].map((r) => (r === null ? "—" : pct(r))).join(" / ")}
                    </Td>
                    <Td className="text-right">
                      {c.capAmount === null ? "—" : thb(c.capAmount)} / {c.minBasket === null ? "—" : thb(c.minBasket)}
                    </Td>
                    <Td className="text-[11px]">
                      {c.effectiveFrom ? dateTime(c.effectiveFrom) : "—"} → {c.effectiveTo ? dateTime(c.effectiveTo) : "ไม่กำหนด"}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <OriginBadge origin={c.dataOrigin} />
                        <span className="text-[11px] text-muted">{c.sourceReference ?? "—"}</span>
                      </div>
                    </Td>
                  </Tr>
                )),
              )}
              {offers.every((o) => o.commissionHistory.length === 0) && (
                <tr>
                  <Td colSpan={7} className="py-8 text-center text-muted">
                    ยังไม่มีข้อมูลค่าคอม — นำเข้าจากแหล่งที่ได้รับอนุญาต
                  </Td>
                </tr>
              )}
            </tbody>
          </Table>
        </TableWrap>
      </Card>
    </div>
  );
}
