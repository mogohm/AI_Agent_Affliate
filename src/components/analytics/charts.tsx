"use client";
import * as React from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { num, thb } from "@/lib/format";

/**
 * Chart colour roles. Hues are the dataviz reference palette, validated (validate_palette.js)
 * against each theme surface: dark steps for themes A/C, light steps for theme B.
 * Series identity is also carried by legend + table view (never colour alone).
 */
export function VizStyle() {
  return (
    <style>{`
      .viz-root { --series-1: #3987e5; --series-2: #d95926; --series-3: #199e70; --grid: var(--line); }
      [data-theme="B"] .viz-root { --series-1: #2a78d6; --series-2: #eb6834; --series-3: #1baf7a; }
    `}</style>
  );
}

export type TrendPoint = { date: string; clicks: number; pending: number; approved: number; reversed: number; orders: number };

const shortDate = (d: string) => {
  const [, m, day] = d.split("-");
  return `${Number(day)}/${Number(m)}`;
};

function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="mb-2 flex flex-wrap gap-4 text-[11px] text-muted">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

function TipBox({ title, rows }: { title: string; rows: { color: string; label: string; value: string }[] }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[11px] shadow-lg">
      <div className="mb-1 font-bold text-fg">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted">
            <span className="inline-block size-2 rounded-sm" style={{ background: r.color }} />
            {r.label}
          </span>
          <span className="font-semibold text-fg tabular-nums">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

const axis = { stroke: "var(--muted)", fontSize: 10, tickLine: false, axisLine: false } as const;

/** Stacked daily commission: validated (approved+paid) and pending. Reversed is shown in KPIs/table, not stacked. */
export function CommissionTrendChart({ data }: { data: TrendPoint[] }) {
  const tickEvery = Math.max(1, Math.ceil(data.length / 10));
  return (
    <div className="viz-root">
      <Legend
        items={[
          { color: "var(--series-1)", label: "อนุมัติ + จ่ายแล้ว (Validated)" },
          { color: "var(--series-2)", label: "รอตรวจสอบ (Pending)" },
        ]}
      />
      <div className="h-56" role="img" aria-label="กราฟค่าคอมมิชชันรายวัน แยกสถานะ Validated และ Pending">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: -8, bottom: 0 }} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke="var(--grid)" strokeDasharray="3 3" />
            <XAxis dataKey="date" tickFormatter={shortDate} interval={tickEvery - 1} {...axis} />
            <YAxis tickFormatter={(v) => `฿${num(v)}`} width={56} {...axis} />
            <Tooltip
              cursor={{ fill: "color-mix(in srgb, var(--accent) 8%, transparent)" }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TipBox
                    title={String(label)}
                    rows={[
                      { color: "var(--series-1)", label: "Validated", value: thb(Number(payload[0]?.payload.approved), 2) },
                      { color: "var(--series-2)", label: "Pending", value: thb(Number(payload[0]?.payload.pending), 2) },
                      { color: "var(--danger)", label: "Reversed", value: thb(Number(payload[0]?.payload.reversed), 2) },
                      { color: "transparent", label: "Orders", value: num(Number(payload[0]?.payload.orders)) },
                    ]}
                  />
                ) : null
              }
            />
            <Bar dataKey="approved" stackId="c" fill="var(--series-1)" stroke="var(--surface)" strokeWidth={1} />
            <Bar dataKey="pending" stackId="c" fill="var(--series-2)" stroke="var(--surface)" strokeWidth={1} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function ClicksChart({ data }: { data: TrendPoint[] }) {
  const tickEvery = Math.max(1, Math.ceil(data.length / 10));
  return (
    <div className="viz-root">
      <div className="h-40" role="img" aria-label="กราฟจำนวนคลิกรายวัน">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 6, left: -8, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" strokeDasharray="3 3" />
            <XAxis dataKey="date" tickFormatter={shortDate} interval={tickEvery - 1} {...axis} />
            <YAxis tickFormatter={(v) => num(v)} width={48} {...axis} />
            <Tooltip
              cursor={{ stroke: "var(--muted)", strokeDasharray: "3 3" }}
              content={({ active, payload, label }) =>
                active && payload?.length ? <TipBox title={String(label)} rows={[{ color: "var(--series-3)", label: "Clicks", value: num(Number(payload[0]?.value)) }]} /> : null
              }
            />
            <Line type="monotone" dataKey="clicks" stroke="var(--series-3)" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function CostChart({ data }: { data: { d: string; usd: number }[] }) {
  return (
    <div className="viz-root">
      <div className="h-40" role="img" aria-label="กราฟต้นทุน AI รายวัน (USD)">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" strokeDasharray="3 3" />
            <XAxis dataKey="d" tickFormatter={shortDate} {...axis} />
            <YAxis tickFormatter={(v) => `$${v}`} width={48} {...axis} />
            <Tooltip
              cursor={{ fill: "color-mix(in srgb, var(--accent) 8%, transparent)" }}
              content={({ active, payload, label }) =>
                active && payload?.length ? <TipBox title={String(label)} rows={[{ color: "var(--series-3)", label: "AI cost", value: `$${Number(payload[0]?.value).toFixed(4)}` }]} /> : null
              }
            />
            <Bar dataKey="usd" fill="var(--series-3)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
