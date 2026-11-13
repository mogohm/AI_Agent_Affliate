"use client";
import * as React from "react";
import { Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FormRow, Input, Select, Textarea } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState, ErrorState, LoadingRows, Note } from "@/components/ui/states";
import { useCan } from "@/components/session-context";
import { api, ApiClientError, useApi } from "@/lib/client/api";
import { dateTime } from "@/lib/format";

type Template = {
  id: string;
  key: string;
  name: string;
  style: string;
  description: string | null;
  version: number;
  prompt: string;
  config: { durationSec: number; sceneCount: number; structure: string[]; palette: { from: string; to: string; accent: string }; music: "none" | "calm" | "upbeat" };
  isActive: boolean;
  updatedAt: string;
};

const STYLES = [
  ["showcase", "Product Showcase"],
  ["review", "Review Style"],
  ["problem_solution", "Problem / Solution"],
  ["promo", "Promotional"],
  ["three_benefits", "3 จุดเด่น"],
  ["comparison", "Comparison"],
] as const;
const SHOTS = ["hook", "problem", "solution", "showcase", "benefit", "cta"];

export function TemplatesSettings() {
  const canManage = useCan("settings:manage");
  const r = useApi<{ items: Template[] }>("/api/templates?all=1");
  const [editing, setEditing] = React.useState<Template | "new" | null>(null);

  const groups = React.useMemo(() => {
    const m = new Map<string, Template[]>();
    for (const t of r.data?.items ?? []) m.set(t.key, [...(m.get(t.key) ?? []), t]);
    return [...m.values()].map((vs) => vs.sort((a, b) => b.version - a.version));
  }, [r.data]);

  const toggle = async (t: Template, isActive: boolean) => {
    try {
      await api("/api/templates", { method: "PATCH", body: { id: t.id, isActive } });
      toast.success(isActive ? "เปิดใช้ Template" : "ปิด Template");
      await r.reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (r.error) return <ErrorState error={r.error} onRetry={r.reload} />;
  if (!r.data) return <LoadingRows rows={4} />;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <Note className="flex-1">การแก้ไขสร้างเวอร์ชันใหม่ (version+1) และเก็บเวอร์ชันเก่าไว้ตรวจสอบย้อนหลัง · กฎความถูกต้องของข้อมูลสินค้าถูกบังคับใช้กับทุก Template</Note>
        {canManage && (
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Plus /> Template ใหม่
          </Button>
        )}
      </div>
      {!groups.length ? (
        <EmptyState title="ยังไม่มี Template" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {groups.map((vs) => {
            const latest = vs[0];
            const active = vs.find((v) => v.isActive) ?? null;
            return (
              <Card key={latest.key} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="inline-block size-4 rounded" style={{ background: `linear-gradient(135deg, ${latest.config.palette.from}, ${latest.config.palette.to})` }} />
                      <strong className="truncate text-sm">{latest.name}</strong>
                      <Badge tone="muted">v{latest.version}</Badge>
                    </div>
                    <p className="mt-1 text-[11px] text-muted">{latest.description}</p>
                    <p className="mt-1 text-[11px] text-muted">
                      {latest.config.durationSec}s · {latest.config.structure.join(" → ")} · เพลง {latest.config.music} · {vs.length} เวอร์ชัน · แก้ไข {dateTime(latest.updatedAt)}
                    </p>
                  </div>
                  <Switch checked={!!active} disabled={!canManage} onCheckedChange={(v) => toggle(latest, v)} aria-label={`เปิด/ปิด ${latest.name}`} />
                </div>
                {canManage && (
                  <Button size="sm" variant="ghost" className="mt-2" onClick={() => setEditing(latest)}>
                    <Pencil /> แก้ไข (สร้าง v{latest.version + 1})
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      )}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <DialogContent title={editing === "new" ? "Template ใหม่" : `แก้ไข ${editing.name}`} wide>
            <TemplateForm
              template={editing === "new" ? null : editing}
              onDone={async () => {
                setEditing(null);
                await r.reload();
              }}
            />
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function TemplateForm({ template, onDone }: { template: Template | null; onDone: () => void }) {
  const [key, setKey] = React.useState("");
  const [name, setName] = React.useState(template?.name ?? "");
  const [style, setStyle] = React.useState(template?.style ?? "showcase");
  const [description, setDescription] = React.useState(template?.description ?? "");
  const [prompt, setPrompt] = React.useState(template?.prompt ?? "");
  const [duration, setDuration] = React.useState(String(template?.config.durationSec ?? 20));
  const [structure, setStructure] = React.useState((template?.config.structure ?? ["hook", "showcase", "benefit", "cta"]).join(","));
  const [music, setMusic] = React.useState(template?.config.music ?? "calm");
  const [from, setFrom] = React.useState(template?.config.palette.from ?? "#38347a");
  const [to, setTo] = React.useState(template?.config.palette.to ?? "#14546f");
  const [accent, setAccent] = React.useState(template?.config.palette.accent ?? "#8d7dfb");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const shots = structure.split(",").map((s) => s.trim()).filter(Boolean);
    const config = {
      durationSec: Number(duration),
      sceneCount: Math.max(1, shots.length),
      structure: shots,
      palette: { from, to, accent },
      music,
    };
    try {
      if (template) await api("/api/templates", { method: "PATCH", body: { id: template.id, name, style, description, prompt, config } });
      else await api("/api/templates", { method: "POST", body: { key, name, style, description, prompt, config } });
      toast.success("บันทึก Template แล้ว");
      onDone();
    } catch (err) {
      const d = err instanceof ApiClientError && Array.isArray(err.details) ? (err.details as { path: string; message: string }[]).map((x) => `${x.path}: ${x.message}`).join(" · ") : "";
      setError(`${(err as Error).message}${d ? ` — ${d}` : ""}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <div className="grid gap-x-3 sm:grid-cols-2">
        {!template && (
          <FormRow label="Key (a-z, 0-9, -)" htmlFor="t-key">
            <Input id="t-key" required value={key} onChange={(e) => setKey(e.target.value)} placeholder="my-template" />
          </FormRow>
        )}
        <FormRow label="ชื่อ" htmlFor="t-name">
          <Input id="t-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </FormRow>
        <FormRow label="รูปแบบ" htmlFor="t-style">
          <Select id="t-style" value={style} onChange={(e) => setStyle(e.target.value)}>
            {STYLES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </FormRow>
        <FormRow label="ความยาว (วินาที)" htmlFor="t-dur">
          <Input id="t-dur" type="number" min={8} max={60} value={duration} onChange={(e) => setDuration(e.target.value)} />
        </FormRow>
        <FormRow label={`ลำดับฉาก (คั่นด้วย , : ${SHOTS.join("/")})`} htmlFor="t-struct">
          <Input id="t-struct" value={structure} onChange={(e) => setStructure(e.target.value)} />
        </FormRow>
        <FormRow label="เพลงประกอบ (สังเคราะห์ในระบบ — มีสิทธิ์ใช้งาน)" htmlFor="t-music">
          <Select id="t-music" value={music} onChange={(e) => setMusic(e.target.value as "none" | "calm" | "upbeat")}>
            <option value="none">ไม่มี</option>
            <option value="calm">Calm</option>
            <option value="upbeat">Upbeat</option>
          </Select>
        </FormRow>
        <FormRow label="สี (from / to / accent)">
          <div className="flex gap-2">
            <input type="color" aria-label="from" value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 w-full cursor-pointer rounded-lg border border-line bg-surface" />
            <input type="color" aria-label="to" value={to} onChange={(e) => setTo(e.target.value)} className="h-10 w-full cursor-pointer rounded-lg border border-line bg-surface" />
            <input type="color" aria-label="accent" value={accent} onChange={(e) => setAccent(e.target.value)} className="h-10 w-full cursor-pointer rounded-lg border border-line bg-surface" />
          </div>
        </FormRow>
      </div>
      <FormRow label="คำอธิบาย" htmlFor="t-desc">
        <Input id="t-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
      </FormRow>
      <FormRow label="Prompt (แนวทางสร้างสคริปต์)" htmlFor="t-prompt" hint="ระบบเพิ่มกฎความถูกต้อง (ใช้ข้อเท็จจริงของสินค้าเท่านั้น ห้ามรีวิวปลอม/อ้างผลเกินจริง) ให้อัตโนมัติ">
        <Textarea id="t-prompt" required rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </FormRow>
      {error && <ErrorState error={error} className="mb-3" />}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={busy}>
          บันทึก
        </Button>
      </div>
    </form>
  );
}
