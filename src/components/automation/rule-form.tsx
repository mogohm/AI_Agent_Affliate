"use client";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormRow, Input, Select } from "@/components/ui/form";
import { SwitchRow } from "@/components/ui/switch";
import { ErrorState, Note } from "@/components/ui/states";
import { api, ApiClientError } from "@/lib/client/api";
import type { Overview, Rule } from "./types";

type FormState = {
  name: string;
  enabled: boolean;
  minCommissionAmount: string;
  minCommissionRate: string;
  minScore: string;
  minConfidence: string;
  categoryIds: string[];
  marketplaces: ("shopee" | "lazada")[];
  excludeAlreadyProduced: boolean;
  requireAuthorizedImage: boolean;
  templateKey: string;
  language: "th" | "en";
  renderMode: "hybrid" | "generative";
  videosPerDay: string;
  autoGenerateScript: boolean;
  autoRender: boolean;
  maxCostPerVideoUsd: string;
  schedule: "manual" | "daily";
  scheduleTime: string;
};

const toStr = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
const toNum = (s: string) => (s.trim() === "" ? null : Number(s));

function initial(rule: Rule | null, overview: Overview): FormState {
  return {
    name: rule?.name ?? "",
    enabled: rule?.enabled ?? false,
    minCommissionAmount: toStr(rule?.conditions.minCommissionAmount ?? (rule ? null : 50)),
    minCommissionRate: toStr(rule?.conditions.minCommissionRate),
    minScore: toStr(rule?.conditions.minScore ?? (rule ? null : 60)),
    minConfidence: toStr(rule?.conditions.minConfidence ?? (rule ? null : 0.4)),
    categoryIds: rule?.conditions.categoryIds ?? [],
    marketplaces: rule?.conditions.marketplaces ?? [],
    excludeAlreadyProduced: rule?.conditions.excludeAlreadyProduced ?? true,
    requireAuthorizedImage: rule?.conditions.requireAuthorizedImage ?? false,
    templateKey: rule?.actions.templateKey ?? overview.templates[0]?.key ?? "product-showcase",
    language: rule?.actions.language ?? "th",
    renderMode: rule?.actions.renderMode ?? "hybrid",
    videosPerDay: String(rule?.actions.videosPerDay ?? 3),
    autoGenerateScript: rule?.actions.autoGenerateScript ?? true,
    autoRender: rule?.actions.autoRender ?? false,
    maxCostPerVideoUsd: toStr(rule?.actions.maxCostPerVideoUsd ?? (rule ? null : 0.5)),
    schedule: rule?.schedule ?? "manual",
    scheduleTime: rule?.scheduleTime ?? "09:00",
  };
}

export function RuleForm({ rule, overview, onSaved, onCancel }: { rule: Rule | null; overview: Overview; onSaved: () => void; onCancel: () => void }) {
  const [f, setF] = React.useState<FormState>(() => initial(rule, overview));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const toggleIn = <T extends string>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      name: f.name,
      enabled: f.enabled,
      conditions: {
        minCommissionAmount: toNum(f.minCommissionAmount),
        minCommissionRate: toNum(f.minCommissionRate),
        minScore: toNum(f.minScore),
        minConfidence: toNum(f.minConfidence),
        categoryIds: f.categoryIds,
        marketplaces: f.marketplaces,
        excludeAlreadyProduced: f.excludeAlreadyProduced,
        requireAuthorizedImage: f.requireAuthorizedImage,
      },
      actions: {
        templateKey: f.templateKey,
        language: f.language,
        renderMode: f.renderMode,
        videosPerDay: Number(f.videosPerDay),
        autoGenerateScript: f.autoGenerateScript,
        autoRender: f.autoRender,
        requireApproval: true,
        maxCostPerVideoUsd: toNum(f.maxCostPerVideoUsd),
      },
      schedule: f.schedule,
      scheduleTime: f.scheduleTime,
    };
    try {
      if (rule) await api(`/api/automation/rules/${rule.id}`, { method: "PATCH", body });
      else await api("/api/automation/rules", { method: "POST", body });
      toast.success(rule ? "บันทึกกฎแล้ว" : "สร้างกฎใหม่แล้ว");
      onSaved();
    } catch (err) {
      const d = err instanceof ApiClientError && Array.isArray(err.details) ? (err.details as { path: string; message: string }[]).map((x) => `${x.path}: ${x.message}`).join(" · ") : "";
      setError(`${(err as Error).message}${d ? ` — ${d}` : ""}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <FormRow label="ชื่อกฎ" htmlFor="rule-name">
        <Input id="rule-name" required value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="เช่น อุปกรณ์ครีเอเตอร์ ค่าคอมสูง" />
      </FormRow>

      <h3 className="mt-2 mb-3 text-xs font-extrabold tracking-wider text-accent-2 uppercase">เงื่อนไขคัดเลือกสินค้า</h3>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <FormRow label="ค่าคอมประมาณการขั้นต่ำ (฿/ออเดอร์)" htmlFor="r-amt" hint="คำนวณจากราคา × อัตรา (มีเพดาน) — ไม่ใช้ % อย่างเดียว">
          <Input id="r-amt" type="number" min={0} step="1" value={f.minCommissionAmount} onChange={(e) => set("minCommissionAmount", e.target.value)} />
        </FormRow>
        <FormRow label="อัตราค่าคอมขั้นต่ำ (%)" htmlFor="r-rate">
          <Input id="r-rate" type="number" min={0} max={100} step="0.1" value={f.minCommissionRate} onChange={(e) => set("minCommissionRate", e.target.value)} />
        </FormRow>
        <FormRow label="Opportunity Score ขั้นต่ำ (0–100)" htmlFor="r-score">
          <Input id="r-score" type="number" min={0} max={100} value={f.minScore} onChange={(e) => set("minScore", e.target.value)} />
        </FormRow>
        <FormRow label="ความเชื่อมั่นข้อมูลขั้นต่ำ (0–1)" htmlFor="r-conf" hint="ต่ำกว่านี้ให้คนตรวจสอบก่อน">
          <Input id="r-conf" type="number" min={0} max={1} step="0.05" value={f.minConfidence} onChange={(e) => set("minConfidence", e.target.value)} />
        </FormRow>
      </div>
      <FormRow label="Marketplace (ไม่เลือก = ทั้งหมด)">
        <div className="flex gap-3 text-sm">
          {(["shopee", "lazada"] as const).map((m) => (
            <label key={m} className="flex items-center gap-1.5">
              <input type="checkbox" checked={f.marketplaces.includes(m)} onChange={() => set("marketplaces", toggleIn(f.marketplaces, m))} />
              {m === "shopee" ? "Shopee" : "Lazada"}
            </label>
          ))}
        </div>
      </FormRow>
      <FormRow label="หมวดหมู่ (ไม่เลือก = ทั้งหมด)">
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
          {overview.categories.map((c) => (
            <label key={c.id} className="flex items-center gap-1.5">
              <input type="checkbox" checked={f.categoryIds.includes(c.id)} onChange={() => set("categoryIds", toggleIn(f.categoryIds, c.id))} />
              {c.name}
            </label>
          ))}
        </div>
      </FormRow>
      <SwitchRow id="r-excl" title="ข้ามสินค้าที่มีวิดีโอแล้ว" checked={f.excludeAlreadyProduced} onCheckedChange={(v) => set("excludeAlreadyProduced", v)} />
      <SwitchRow id="r-img" title="ต้องมีภาพสินค้าที่ยืนยันสิทธิ์แล้ว" description="ป้องกันการผลิตจากภาพที่สิทธิ์ไม่ชัดเจน" checked={f.requireAuthorizedImage} onCheckedChange={(v) => set("requireAuthorizedImage", v)} />

      <h3 className="mt-5 mb-3 text-xs font-extrabold tracking-wider text-accent-2 uppercase">การผลิต</h3>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <FormRow label="Template" htmlFor="r-tpl">
          <Select id="r-tpl" value={f.templateKey} onChange={(e) => set("templateKey", e.target.value)}>
            {overview.templates.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
          </Select>
        </FormRow>
        <FormRow label="ภาษา" htmlFor="r-lang">
          <Select id="r-lang" value={f.language} onChange={(e) => set("language", e.target.value as "th" | "en")}>
            <option value="th">ไทย</option>
            <option value="en">English</option>
          </Select>
        </FormRow>
        <FormRow label="โหมดเรนเดอร์" htmlFor="r-mode">
          <Select id="r-mode" value={f.renderMode} onChange={(e) => set("renderMode", e.target.value as "hybrid" | "generative")}>
            <option value="hybrid">Hybrid (ภาพสินค้า + Motion / FFmpeg)</option>
            <option value="generative">Generative AI Video (ต้องเปิดใน Settings)</option>
          </Select>
        </FormRow>
        <FormRow label="จำนวนวิดีโอต่อวัน" htmlFor="r-quota">
          <Input id="r-quota" type="number" min={1} max={100} value={f.videosPerDay} onChange={(e) => set("videosPerDay", e.target.value)} />
        </FormRow>
        <FormRow label="เพดานค่าใช้จ่าย AI ต่อคลิป (USD)" htmlFor="r-cost" hint="ตรวจก่อนส่งงานเข้าคิว ร่วมกับงบรายวัน/รายเดือน">
          <Input id="r-cost" type="number" min={0} step="0.05" value={f.maxCostPerVideoUsd} onChange={(e) => set("maxCostPerVideoUsd", e.target.value)} />
        </FormRow>
        <FormRow label="ตารางเวลา" htmlFor="r-sched">
          <div className="flex gap-2">
            <Select id="r-sched" value={f.schedule} onChange={(e) => set("schedule", e.target.value as "manual" | "daily")}>
              <option value="manual">รันด้วยตนเอง</option>
              <option value="daily">ทุกวัน (เวลาไทย)</option>
            </Select>
            {f.schedule === "daily" && <Input aria-label="เวลา" type="time" value={f.scheduleTime} onChange={(e) => set("scheduleTime", e.target.value)} className="w-32" />}
          </div>
        </FormRow>
      </div>
      <SwitchRow id="r-script" title="สร้างสคริปต์ + Storyboard อัตโนมัติ" checked={f.autoGenerateScript} onCheckedChange={(v) => set("autoGenerateScript", v)} />
      <SwitchRow id="r-render" title="เรนเดอร์อัตโนมัติหลังอนุมัติสคริปต์" description="ป้องกันการผลิตสินค้าเสี่ยง — สคริปต์ต้องผ่านคนตรวจก่อนเสมอ" checked={f.autoRender} onCheckedChange={(v) => set("autoRender", v)} />
      <SwitchRow id="r-enabled" title="เปิดใช้งานกฎ" checked={f.enabled} onCheckedChange={(v) => set("enabled", v)} />
      <Note className="mt-3">
        <b>Human approval เสมอ:</b> กฎอัตโนมัติไม่สามารถเผยแพร่คอนเทนต์ได้ วิดีโอทุกชิ้นต้องผ่านการตรวจและอนุมัติโดย Approver ก่อนเผยแพร่
      </Note>
      {error && <ErrorState error={error} className="mt-3" />}
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          ยกเลิก
        </Button>
        <Button type="submit" variant="primary" loading={saving}>
          {rule ? "บันทึก" : "สร้างกฎ"}
        </Button>
      </div>
    </form>
  );
}
