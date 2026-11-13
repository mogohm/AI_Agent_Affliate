"use client";
import * as React from "react";
import { KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FormRow, Input, Select } from "@/components/ui/form";
import { SwitchRow } from "@/components/ui/switch";
import { ErrorState, LoadingRows, Note } from "@/components/ui/states";
import { useCan } from "@/components/session-context";
import { api, useApi } from "@/lib/client/api";

type AiView = {
  mode: "demo" | "live";
  effectiveMode: "demo" | "live";
  reason: string | null;
  models: { text: string; image: string; tts: string; video: string; imageQuality: "low" | "medium" | "high" };
  pricing: { textInputPer1M: number; textOutputPer1M: number; imagePerImage: number; ttsPer1MChars: number; videoPerSecond: number };
  key: { configured: boolean; source: "workspace" | "env" | null; masked: string | null };
};

const PRICE_FIELDS: { key: keyof AiView["pricing"]; label: string }[] = [
  { key: "textInputPer1M", label: "Text input / 1M tokens" },
  { key: "textOutputPer1M", label: "Text output / 1M tokens" },
  { key: "imagePerImage", label: "Image / ภาพ" },
  { key: "ttsPer1MChars", label: "TTS / 1M ตัวอักษร" },
  { key: "videoPerSecond", label: "Video / วินาที" },
];

export function AiSettings() {
  const canManage = useCan("settings:manage");
  const canCred = useCan("credentials:manage");
  const r = useApi<AiView>("/api/settings/ai");
  const [models, setModels] = React.useState<AiView["models"] | null>(null);
  const [pricing, setPricing] = React.useState<Record<string, string> | null>(null);
  const [newKey, setNewKey] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (r.data) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initialise editable copies from loaded settings
      setModels(r.data.models);
      setPricing(Object.fromEntries(Object.entries(r.data.pricing).map(([k, v]) => [k, String(v)])));
    }
  }, [r.data]);

  const run = async (label: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(label);
    try {
      await fn();
      toast.success(ok);
      await r.reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (r.error) return <ErrorState error={r.error} onRetry={r.reload} />;
  if (!r.data || !models || !pricing) return <LoadingRows rows={4} />;
  const d = r.data;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader
          title="OpenAI — Text, Image, TTS & Video"
          description="ใช้สร้างการวิเคราะห์สินค้า สคริปต์ Storyboard ภาพ เสียงพากย์ และ B-roll"
          actions={<Badge tone={d.effectiveMode === "live" ? "green" : "orange"}>{d.effectiveMode === "live" ? "● Live" : "● Demo mode"}</Badge>}
        />
        {d.reason && <Note className="mb-3">{d.reason}</Note>}
        <SwitchRow
          id="ai-live"
          title="เปิด Live AI (เรียก OpenAI API จริง — มีค่าใช้จ่าย)"
          description="ปิด = Demo mode: ใช้ตัวสร้างตัวอย่างในระบบ ไม่เรียก API และไม่มีค่าใช้จ่าย"
          checked={d.mode === "live"}
          disabled={!canManage || busy === "mode"}
          onCheckedChange={(v) => run("mode", () => api("/api/settings/ai", { method: "PATCH", body: { mode: v ? "live" : "demo" } }), v ? "เปิด Live AI แล้ว" : "กลับเป็น Demo mode")}
        />
        <div className="mt-4 rounded-xl border border-line bg-surface-2 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-bold">
            <KeyRound className="size-4" /> OpenAI API Key
            {d.key.configured ? <Badge tone="green">ตั้งค่าแล้ว {d.key.masked}</Badge> : <Badge tone="orange">ยังไม่ได้ตั้งค่า</Badge>}
            {d.key.source && <Badge tone="muted">{d.key.source === "env" ? "จาก ENV (OPENAI_API_KEY)" : "เก็บแบบเข้ารหัสใน Workspace"}</Badge>}
          </div>
          <p className="mb-3 text-[11px] text-muted">Key ถูกเข้ารหัส AES-256-GCM ฝั่ง Server และจะไม่ถูกส่งกลับมาที่เบราว์เซอร์ (Write-only)</p>
          {canCred ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input type="password" autoComplete="off" placeholder={d.key.configured ? "วาง Key ใหม่เพื่อแทนที่" : "sk-..."} value={newKey} onChange={(e) => setNewKey(e.target.value)} aria-label="OpenAI API Key" />
              <Button
                variant="primary"
                disabled={!newKey.trim()}
                loading={busy === "key"}
                onClick={() =>
                  run(
                    "key",
                    async () => {
                      await api("/api/settings/ai/key", { method: "PUT", body: { apiKey: newKey.trim() } });
                      setNewKey("");
                    },
                    "บันทึก API Key แล้ว",
                  )
                }
              >
                บันทึก
              </Button>
            </div>
          ) : (
            <p className="text-[11px] text-muted">เฉพาะ Admin เท่านั้นที่จัดการ Credentials ได้</p>
          )}
          {canCred && d.key.configured && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                loading={busy === "test"}
                onClick={async () => {
                  setBusy("test");
                  try {
                    const t = await api<{ ok: boolean; message: string; modelCount: number | null }>("/api/settings/ai/test", { method: "POST" });
                    if (t.ok) toast.success(`${t.message} (${t.modelCount ?? "?"} models)`);
                    else toast.error(t.message);
                  } catch (e) {
                    toast.error((e as Error).message);
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                <ShieldCheck /> ตรวจสอบ Key (ฟรี: GET /v1/models)
              </Button>
              {d.key.source === "workspace" && (
                <Button size="sm" variant="ghost" loading={busy === "del"} onClick={() => run("del", () => api("/api/settings/ai/key", { method: "DELETE" }), "ลบ API Key แล้ว")}>
                  <Trash2 /> ลบ Key
                </Button>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Models & ราคาประมาณการ" description="ใช้ตรวจงบประมาณก่อนส่งงาน — ตรวจสอบราคาปัจจุบันกับหน้า Pricing ของผู้ให้บริการเสมอ" />
        <div className="grid gap-x-3 sm:grid-cols-2">
          {(["text", "image", "tts", "video"] as const).map((k) => (
            <FormRow key={k} label={`Model: ${k}`} htmlFor={`m-${k}`}>
              <Input id={`m-${k}`} value={models[k]} disabled={!canManage} onChange={(e) => setModels({ ...models, [k]: e.target.value })} />
            </FormRow>
          ))}
          <FormRow label="คุณภาพภาพ" htmlFor="m-q">
            <Select id="m-q" value={models.imageQuality} disabled={!canManage} onChange={(e) => setModels({ ...models, imageQuality: e.target.value as "low" | "medium" | "high" })}>
              <option value="low">Low (เร็ว/ถูก)</option>
              <option value="medium">Medium</option>
              <option value="high">High fidelity</option>
            </Select>
          </FormRow>
        </div>
        <h3 className="mb-2 text-xs font-bold">ราคาประมาณการ (USD)</h3>
        <div className="grid gap-x-3 sm:grid-cols-2">
          {PRICE_FIELDS.map((p) => (
            <FormRow key={p.key} label={p.label} htmlFor={`p-${p.key}`}>
              <Input id={`p-${p.key}`} type="number" min={0} step="0.001" value={pricing[p.key]} disabled={!canManage} onChange={(e) => setPricing({ ...pricing, [p.key]: e.target.value })} />
            </FormRow>
          ))}
        </div>
        {canManage && (
          <div className="flex justify-end">
            <Button
              variant="primary"
              loading={busy === "models"}
              onClick={() =>
                run(
                  "models",
                  () => api("/api/settings/ai", { method: "PATCH", body: { models, pricing: Object.fromEntries(Object.entries(pricing).map(([k, v]) => [k, Number(v)])) } }),
                  "บันทึก Models และราคาแล้ว",
                )
              }
            >
              บันทึก
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
