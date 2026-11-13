"use client";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { FormRow, Input } from "@/components/ui/form";
import { ErrorState, LoadingRows, Note, Progress } from "@/components/ui/states";
import { useCan } from "@/components/session-context";
import { api, useApi } from "@/lib/client/api";
import { thb, usd } from "@/lib/format";

type Budget = { budget: { dailyUsd: number; monthlyUsd: number; perVideoUsd: number; fxThbPerUsd: number }; spent: { todayUsd: number; monthUsd: number } };
type Weights = { commissionAmount: number; sales: number; rating: number; commissionRate: number; trend: number; content: number };

const WEIGHT_LABELS: { key: keyof Weights; label: string }[] = [
  { key: "commissionAmount", label: "ค่าคอมต่อออเดอร์ (ประมาณการ)" },
  { key: "sales", label: "หลักฐานยอดขาย" },
  { key: "rating", label: "คะแนนรีวิว / คุณภาพ" },
  { key: "commissionRate", label: "อัตราค่าคอม %" },
  { key: "trend", label: "Demand / Trend" },
  { key: "content", label: "ศักยภาพทำวิดีโอ" },
];

export function BudgetSettings() {
  const canManage = useCan("settings:manage");
  const r = useApi<Budget>("/api/settings/budget");
  const [f, setF] = React.useState<Record<string, string> | null>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initialise form from loaded settings
    if (r.data) setF(Object.fromEntries(Object.entries(r.data.budget).map(([k, v]) => [k, String(v)])));
  }, [r.data]);

  if (r.error) return <ErrorState error={r.error} onRetry={r.reload} />;
  if (!r.data || !f) return <LoadingRows rows={3} />;
  const b = r.data.budget;
  const save = async () => {
    setBusy(true);
    try {
      await api("/api/settings/budget", { method: "PATCH", body: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Number(v)])) });
      toast.success("บันทึกงบประมาณแล้ว");
      await r.reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const fields: [string, string, string][] = [
    ["dailyUsd", "งบรายวัน (USD)", "0.5"],
    ["monthlyUsd", "งบรายเดือน (USD)", "1"],
    ["perVideoUsd", "เพดานต่อคลิป (USD)", "0.05"],
    ["fxThbPerUsd", "อัตราแลกเปลี่ยน (฿ ต่อ $1)", "0.1"],
  ];
  return (
    <Card>
      <CardHeader title="Budget Guardrails" description="ตรวจสอบก่อนส่งงานที่มีค่าใช้จ่ายเข้าคิวทุกครั้ง (วันตามเวลาไทย)" />
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="text-xs">
          <div className="mb-1 flex justify-between">
            <b>ใช้ไปวันนี้</b>
            <span className="text-muted">
              {usd(r.data.spent.todayUsd)} / {usd(b.dailyUsd)} ({thb(r.data.spent.todayUsd * b.fxThbPerUsd, 2)})
            </span>
          </div>
          <Progress value={b.dailyUsd ? (r.data.spent.todayUsd / b.dailyUsd) * 100 : 0} />
        </div>
        <div className="text-xs">
          <div className="mb-1 flex justify-between">
            <b>ใช้ไปเดือนนี้</b>
            <span className="text-muted">
              {usd(r.data.spent.monthUsd)} / {usd(b.monthlyUsd)} ({thb(r.data.spent.monthUsd * b.fxThbPerUsd, 2)})
            </span>
          </div>
          <Progress value={b.monthlyUsd ? (r.data.spent.monthUsd / b.monthlyUsd) * 100 : 0} />
        </div>
      </div>
      <div className="grid gap-x-3 sm:grid-cols-2 lg:grid-cols-4">
        {fields.map(([k, label, step]) => (
          <FormRow key={k} label={label} htmlFor={`b-${k}`}>
            <Input id={`b-${k}`} type="number" min={0} step={step} value={f[k]} disabled={!canManage} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
          </FormRow>
        ))}
      </div>
      {canManage && (
        <div className="flex justify-end">
          <Button variant="primary" loading={busy} onClick={save}>
            บันทึกงบประมาณ
          </Button>
        </div>
      )}
    </Card>
  );
}

export function ScoringSettings() {
  const canManage = useCan("settings:manage");
  const r = useApi<{ weights: Weights; defaults: Weights }>("/api/settings/scoring");
  const [w, setW] = React.useState<Record<string, string> | null>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initialise form from loaded settings
    if (r.data) setW(Object.fromEntries(Object.entries(r.data.weights).map(([k, v]) => [k, String(v)])));
  }, [r.data]);
  if (r.error) return <ErrorState error={r.error} onRetry={r.reload} />;
  if (!r.data || !w) return <LoadingRows rows={3} />;
  const sum = Object.values(w).reduce((a, v) => a + (Number(v) || 0), 0);
  const save = async (values: Record<string, string | number>) => {
    setBusy(true);
    try {
      await api("/api/settings/scoring", { method: "PATCH", body: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)])) });
      toast.success("บันทึกน้ำหนัก Opportunity Score แล้ว — มีผลกับการวิเคราะห์ครั้งถัดไป");
      await r.reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader title="น้ำหนัก Opportunity Score" description="ปัจจัยที่ไม่มีข้อมูลจะไม่ถูกนำมาคิด (ไม่เดาค่า) และลดความเชื่อมั่นแทน" />
      <div className="grid gap-x-3 sm:grid-cols-2 lg:grid-cols-3">
        {WEIGHT_LABELS.map((x) => (
          <FormRow key={x.key} label={x.label} htmlFor={`w-${x.key}`}>
            <Input id={`w-${x.key}`} type="number" min={0} max={100} value={w[x.key]} disabled={!canManage} onChange={(e) => setW({ ...w, [x.key]: e.target.value })} />
          </FormRow>
        ))}
      </div>
      <Note tone={sum === 100 ? "info" : "warn"} className="mb-3">
        น้ำหนักรวม <b>{sum}</b> {sum === 100 ? "✓" : "— แนะนำให้รวมเป็น 100 เพื่ออ่านง่าย (ระบบจะ normalise ให้อัตโนมัติ)"}
      </Note>
      {canManage && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => save(r.data!.defaults)} loading={busy}>
            คืนค่าเริ่มต้น
          </Button>
          <Button variant="primary" disabled={sum <= 0} loading={busy} onClick={() => save(w)}>
            บันทึก
          </Button>
        </div>
      )}
    </Card>
  );
}
