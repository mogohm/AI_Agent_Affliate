"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormRow, Input, Select } from "@/components/ui/form";
import { SwitchRow } from "@/components/ui/switch";
import { EmptyState, ErrorState, LoadingRows, Note } from "@/components/ui/states";
import { OriginBadge, PlatformLabel } from "@/components/data-badges";
import { useSession } from "@/components/session-context";
import { api, useApi } from "@/lib/client/api";
import { thb } from "@/lib/format";
import { cn } from "@/lib/utils";
import { VISUAL_STYLE_OPTIONS, type OfferOption, type TemplateRow } from "./types";

export function NewProjectPanel({ initialOfferId, onCreated }: { initialOfferId?: string; onCreated?: () => void }) {
  const router = useRouter();
  const session = useSession();
  const [search, setSearch] = React.useState("");
  const [q, setQ] = React.useState("");
  const [offerId, setOfferId] = React.useState<string | null>(initialOfferId ?? null);
  const [form, setForm] = React.useState({
    templateKey: "product-showcase",
    language: "th" as "th" | "en",
    renderMode: "hybrid" as "hybrid" | "generative",
    durationSec: 20,
    voice: "none" as "none" | "female" | "male",
    music: "calm" as "none" | "calm" | "upbeat",
    subtitles: true,
    disclosure: true,
    visualStyle: "premium",
  });
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => setQ(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const offersUrl = `/api/video-projects/offers?${new URLSearchParams({ ...(q ? { search: q } : {}), ...(initialOfferId ? { offerId: initialOfferId } : {}) })}`;
  const offers = useApi<{ items: OfferOption[] }>(offersUrl);
  const templates = useApi<{ items: TemplateRow[] }>("/api/templates");

  const selected = offers.data?.items.find((o) => o.offerId === offerId) ?? null;
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const chooseTemplate = (key: string) => {
    const t = templates.data?.items.find((x) => x.key === key);
    setForm((f) => ({ ...f, templateKey: key, durationSec: t?.config.durationSec ?? f.durationSec, music: t?.config.music ?? f.music }));
  };

  const create = async () => {
    if (!offerId) return toast.error("เลือกสินค้าก่อน");
    setBusy(true);
    try {
      const r = await api<{ project: { id: string } }>("/api/video-projects", { method: "POST", body: { offerId, ...form, generateScript: true } });
      toast.success("สร้างโปรเจกต์แล้ว กำลังสร้างสคริปต์ + Storyboard");
      onCreated?.();
      router.push(`/studio/${r.project.id}`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="สร้างวิดีโอใหม่" description="เลือกสินค้า → ตั้งค่าครีเอทีฟ → ระบบสร้างสคริปต์และ Storyboard ให้ตรวจก่อนเรนเดอร์" actions={<span className="rounded-lg bg-accent/15 px-2 py-1 text-[11px] font-bold text-accent-2">9:16 · Vertical</span>} />
      <FormRow label="1. เลือกสินค้า (เรียงตามค่าคอมต่อออเดอร์)">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input className="pl-9" placeholder="ค้นหาชื่อสินค้า / หมวดหมู่" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="ค้นหาสินค้า" />
        </div>
      </FormRow>
      <div className="mb-4 max-h-64 space-y-1.5 overflow-auto pr-1 scrollbar-thin" role="listbox" aria-label="รายการสินค้า">
        {offers.loading && !offers.data ? (
          <LoadingRows rows={3} />
        ) : offers.error ? (
          <ErrorState error={offers.error} onRetry={offers.reload} />
        ) : !offers.data?.items.length ? (
          <EmptyState title="ไม่พบสินค้า" description="นำเข้าสินค้าจากหน้า สินค้าและค่าคอม ก่อน" />
        ) : (
          offers.data.items.map((o) => (
            <button
              key={o.offerId}
              role="option"
              aria-selected={offerId === o.offerId}
              onClick={() => setOfferId(o.offerId)}
              className={cn(
                "flex w-full cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors",
                offerId === o.offerId ? "border-accent bg-accent/10" : "border-line hover:bg-surface-2",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-bold">{o.title}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                  <PlatformLabel platform={o.platform} />
                  <span>{thb(o.price)}</span>
                  {o.score !== null && <span className="text-accent-2">✦ {o.score}</span>}
                  <OriginBadge origin={o.origin} />
                </div>
              </div>
              <div className="text-right text-xs font-extrabold whitespace-nowrap text-good">
                {o.estCommission !== null ? thb(o.estCommission) : "—"}
                <div className="text-[10px] font-normal text-muted">/ ออเดอร์</div>
              </div>
            </button>
          ))
        )}
      </div>
      {selected?.origin === "demo" && <Note tone="warn" className="mb-4">สินค้านี้เป็นข้อมูลตัวอย่าง (DEMO) — วิดีโอที่ได้ใช้สำหรับทดสอบเท่านั้น</Note>}

      <div className="grid gap-x-3 sm:grid-cols-2">
        <FormRow label="2. Template">
          <Select value={form.templateKey} onChange={(e) => chooseTemplate(e.target.value)} aria-label="Template">
            {(templates.data?.items ?? []).map((t) => (
              <option key={t.id} value={t.key}>
                {t.name} (v{t.version})
              </option>
            ))}
          </Select>
        </FormRow>
        <FormRow label="ภาษา">
          <Select value={form.language} onChange={(e) => set("language", e.target.value as "th" | "en")}>
            <option value="th">ไทย</option>
            <option value="en">English</option>
          </Select>
        </FormRow>
        <FormRow label="โหมดสร้างวิดีโอ">
          <Select value={form.renderMode} onChange={(e) => set("renderMode", e.target.value as "hybrid" | "generative")}>
            <option value="hybrid">Hybrid: ภาพสินค้า + Motion / FFmpeg</option>
            <option value="generative">Generative AI Video (Sora) — ต้องเปิดใน Settings</option>
          </Select>
        </FormRow>
        <FormRow label="ความยาวคลิป">
          <Select value={form.durationSec} onChange={(e) => set("durationSec", Number(e.target.value))}>
            {[15, 20, 25, 30, 45].map((d) => (
              <option key={d} value={d}>
                {d} วินาที
              </option>
            ))}
          </Select>
        </FormRow>
        <FormRow label="เสียงพากย์">
          <Select value={form.voice} onChange={(e) => set("voice", e.target.value as "none" | "female" | "male")}>
            <option value="none">ไม่มีเสียงพากย์</option>
            <option value="female">AI Voice · ผู้หญิง · เป็นกันเอง</option>
            <option value="male">AI Voice · ผู้ชาย · กระตือรือร้น</option>
          </Select>
        </FormRow>
        <FormRow label="เพลงประกอบ (สังเคราะห์เอง ไม่ติดลิขสิทธิ์)">
          <Select value={form.music} onChange={(e) => set("music", e.target.value as "none" | "calm" | "upbeat")}>
            <option value="calm">Calm pad</option>
            <option value="upbeat">Upbeat pluck</option>
            <option value="none">ไม่มีเพลง</option>
          </Select>
        </FormRow>
        <FormRow label="สไตล์ภาพ" className="sm:col-span-2">
          <Select value={form.visualStyle} onChange={(e) => set("visualStyle", e.target.value)}>
            {VISUAL_STYLE_OPTIONS.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </Select>
        </FormRow>
      </div>
      <SwitchRow id="np-subs" title="ใส่ซับไตเติลอัตโนมัติ" description="Thai caption + ไฟล์ .srt" checked={form.subtitles} onCheckedChange={(v) => set("subtitles", v)} />
      <SwitchRow id="np-disc" title="แสดง Affiliate Disclosure" description="ประกาศเนื้อหาส่งเสริมการขาย (แนะนำให้เปิดเสมอ)" checked={form.disclosure} onCheckedChange={(v) => set("disclosure", v)} />
      {(form.voice !== "none" || form.renderMode === "generative") && session.aiMode === "demo" && (
        <Note tone="warn" className="mt-3">
          ขณะนี้อยู่ใน Demo Mode: เสียงพากย์ AI และ Generative Video จะยังไม่ทำงานจนกว่าจะเปิด Live AI ในตั้งค่า (คลิป Demo ใช้เพลง + ซับไตเติล)
        </Note>
      )}
      <Button variant="primary" className="mt-4 w-full" onClick={create} loading={busy} disabled={!offerId} data-testid="create-project">
        <Sparkles /> สร้างโปรเจกต์ + สคริปต์
      </Button>
      <p className="mt-2 text-[11px] text-muted">{session.aiMode === "live" ? "จะเรียก OpenAI API ตามงบประมาณที่ตั้งไว้" : "Demo generator — ไม่เรียก API ที่มีค่าใช้จ่าย"}</p>
    </Card>
  );
}
