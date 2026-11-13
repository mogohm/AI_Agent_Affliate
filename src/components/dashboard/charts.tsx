"use client";
import * as React from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { dateOnly, num, thb } from "@/lib/format";

const AXIS = { fontSize: 11, fill: "var(--muted)" };

function TipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs shadow-card">
      <div className="mb-1 font-bold">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2">
          {r.color && <span className="inline-block size-2.5 rounded-sm" style={{ background: r.color }} />}
          <span className="text-muted">{r.label}</span>
          <span className="ml-auto pl-3 font-bold">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export type TrendPoint = { day: string; pending: number; validated: number };

const SERIES = [
  { key: "validated", label: "อนุมัติ/จ่ายแล้ว", color: "var(--chart-1)" },
  { key: "pending", label: "รอตรวจสอบ", color: "var(--chart-2)" },
] as const;

/** Daily commission, stacked validated + pending (reversed orders excluded). */
export function CommissionTrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-4 text-[11px] text-muted" aria-hidden>
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} /> {s.label}
          </span>
        ))}
      </div>
      <div className="h-[220px]" role="img" aria-label="กราฟค่าคอมมิชชันรายวัน แยกสถานะอนุมัติและรอตรวจสอบ">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="18%">
            <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 3" />
            <XAxis dataKey="day" tickFormatter={(d: string) => dateOnly(d)} tick={AXIS} axisLine={false} tickLine={false} minTickGap={18} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => `฿${num(v)}`} />
            <Tooltip
              cursor={{ fill: "color-mix(in srgb, var(--accent) 8%, transparent)" }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TipBox
                    title={dateOnly(String(label))}
                    rows={SERIES.map((s) => ({ label: s.label, value: thb(Number(payload.find((p) => p.dataKey === s.key)?.value ?? 0), 2), color: s.color }))}
                  />
                ) : null
              }
            />
            <Bar dataKey="validated" stackId="c" fill={SERIES[0].color} stroke="var(--surface)" strokeWidth={1} maxBarSize={28} />
            <Bar dataKey="pending" stackId="c" fill={SERIES[1].color} stroke="var(--surface)" strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export type CategoryPoint = { name: string; products: number; avgEst: number | null };

/** Average estimated commission per order, by category (single series → no legend). */
export function CategoryCommissionChart({ data }: { data: CategoryPoint[] }) {
  const rows = data.filter((d) => d.avgEst !== null);
  return (
    <div style={{ height: Math.max(140, rows.length * 34 + 20) }} role="img" aria-label="ค่าคอมเฉลี่ยต่อออเดอร์ตามหมวดหมู่">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid horizontal={false} stroke="var(--line)" strokeDasharray="3 3" />
          <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v: number) => `฿${num(v)}`} />
          <YAxis type="category" dataKey="name" tick={{ ...AXIS, fill: "var(--text)" }} axisLine={false} tickLine={false} width={128} />
          <Tooltip
            cursor={{ fill: "color-mix(in srgb, var(--accent) 8%, transparent)" }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as CategoryPoint | undefined;
              return active && p ? (
                <TipBox title={p.name} rows={[{ label: "คอม/ออเดอร์เฉลี่ย", value: thb(p.avgEst, 2) }, { label: "จำนวนสินค้า", value: num(p.products) }]} />
              ) : null;
            }}
          />
          <Bar dataKey="avgEst" fill="var(--chart-1)" radius={[0, 4, 4, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
