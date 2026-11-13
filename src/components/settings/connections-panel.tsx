"use client";
import * as React from "react";
import Link from "next/link";
import { FileSpreadsheet, KeyRound, PlugZap, RefreshCw, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { FormRow, Input } from "@/components/ui/form";
import { ErrorState, LoadingRows, Note } from "@/components/ui/states";
import { ConnectionBadge } from "@/components/data-badges";
import { useCan } from "@/components/session-context";
import { api, useApi } from "@/lib/client/api";
import { dateTime, relativeTime } from "@/lib/format";

type Conn = {
  platform: "shopee" | "lazada";
  displayName: string;
  adapterVersion: string;
  status: string;
  accountLabel: string | null;
  lastSyncAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  rateLimitResetAt: string | null;
  capabilities: { productOffers: boolean; commissionRates: boolean; conversionReports: boolean; linkGeneration: boolean };
  requirements: string[];
  credentialFields: { key: string; label: string; secret: boolean }[];
  credentials: Record<string, string | null>;
  hasCredentials: boolean;
};
type Resp = { items: Conn[]; recentImports: { id: string; fileName: string | null; status: string; totalRows: number; createdAt: string }[] };

const CAP_LABEL: Record<string, string> = { productOffers: "ดึงสินค้า", commissionRates: "อัตราค่าคอม", conversionReports: "รายงานออเดอร์", linkGeneration: "สร้างลิงก์" };

/** Marketplace connections: status, encrypted credentials (masked), test & sync. Self-contained. */
export function ConnectionsPanel() {
  const { data, error, loading, reload } = useApi<Resp>("/api/settings/connections");
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading && !data) return <LoadingRows rows={3} />;
  if (!data) return null;
  return (
    <div className="space-y-5">
      <Note>
        ระบบเชื่อมต่อเฉพาะ <b>Official API ที่ได้รับสิทธิ์</b> เท่านั้น ไม่มีการ scrape. ระหว่างรออนุมัติ ให้ใช้{" "}
        <Link href="/products/import" className="underline">
          นำเข้า CSV / Product Feed
        </Link>{" "}
        ที่ดาวน์โหลดจากบัญชี Affiliate ของคุณ. Credentials ถูกเข้ารหัส (AES-256-GCM) ฝั่ง Server และแสดงเฉพาะ 4 ตัวท้าย
      </Note>
      <div className="grid gap-5 xl:grid-cols-2">
        {data.items.map((c) => (
          <ConnectionCard key={c.platform} conn={c} onChange={reload} />
        ))}
      </div>
      <Card>
        <CardHeader
          title="CSV / Product Feed"
          description="แหล่งข้อมูลที่ใช้ได้ทันทีโดยไม่ต้องรอสิทธิ์ API"
          actions={
            <Button asChild size="sm" variant="outline">
              <Link href="/products/import">
                <FileSpreadsheet /> นำเข้าไฟล์
              </Link>
            </Button>
          }
        />
        {data.recentImports.length === 0 ? (
          <p className="text-xs text-muted">ยังไม่มีการนำเข้า</p>
        ) : (
          <ul className="space-y-1.5 text-xs">
            {data.recentImports.map((r) => (
              <li key={r.id} className="flex justify-between gap-2">
                <span className="truncate">{r.fileName ?? "—"}</span>
                <span className="shrink-0 text-muted">
                  {r.totalRows} แถว · {r.status} · {relativeTime(r.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ConnectionCard({ conn, onChange }: { conn: Conn; onChange: () => void }) {
  const canManage = useCan("credentials:manage");
  const [editing, setEditing] = React.useState(false);
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [label, setLabel] = React.useState(conn.accountLabel ?? "");
  const [busy, setBusy] = React.useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      const r = await fn();
      if (ok) toast.success(ok);
      onChange();
      return r;
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    run(
      "save",
      async () => {
        const credentials = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ""));
        await api(`/api/settings/connections/${conn.platform}`, { method: "POST", body: { credentials, accountLabel: label || null } });
        setValues({});
        setEditing(false);
      },
      "บันทึก Credentials (เข้ารหัส) แล้ว — กด 'ทดสอบการเชื่อมต่อ' เพื่อยืนยันสิทธิ์",
    );

  const test = () =>
    run("test", async () => {
      const r = await api<{ status: string; message: string }>(`/api/settings/connections/${conn.platform}/test`, { method: "POST" });
      if (r.status === "connected") toast.success(r.message);
      else toast.warning(r.message);
    });

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-xl bg-surface-2 text-lg" aria-hidden>
              {conn.platform === "shopee" ? "🟠" : "🟣"}
            </span>
            {conn.displayName}
          </span>
        }
        description={`Adapter ${conn.adapterVersion}${conn.accountLabel ? ` · ${conn.accountLabel}` : ""}`}
        actions={<ConnectionBadge status={conn.status} />}
      />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {Object.entries(conn.capabilities).map(([k, v]) => (
          <Badge key={k} tone={v ? "green" : "muted"}>
            {v ? "✓" : "—"} {CAP_LABEL[k] ?? k}
          </Badge>
        ))}
      </div>
      <ul className="mb-3 list-disc space-y-1 pl-4 text-[11px] text-muted">
        {conn.requirements.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <dl className="mb-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted">ตรวจสอบล่าสุด</dt>
        <dd>{conn.lastCheckedAt ? dateTime(conn.lastCheckedAt) : "—"}</dd>
        <dt className="text-muted">ซิงก์ล่าสุด</dt>
        <dd>{conn.lastSyncAt ? dateTime(conn.lastSyncAt) : "—"}</dd>
        {conn.credentialFields.map((f) => (
          <React.Fragment key={f.key}>
            <dt className="text-muted">{f.label}</dt>
            <dd className="font-mono">{conn.credentials[f.key] ?? "—"}</dd>
          </React.Fragment>
        ))}
        {conn.rateLimitResetAt && (
          <>
            <dt className="text-muted">Rate limit ถึง</dt>
            <dd>{dateTime(conn.rateLimitResetAt)}</dd>
          </>
        )}
      </dl>
      {conn.lastError && <ErrorState error={conn.lastError} className="mb-3 text-xs" />}

      {!canManage ? (
        <p className="text-[11px] text-muted">เฉพาะ Admin เท่านั้นที่จัดการ Credentials ได้</p>
      ) : editing ? (
        <div className="rounded-xl border border-line bg-surface-2 p-3">
          <FormRow label="ชื่อบัญชี (สำหรับแสดงผล)" htmlFor={`${conn.platform}-label`}>
            <Input id={`${conn.platform}-label`} value={label} onChange={(e) => setLabel(e.target.value)} />
          </FormRow>
          {conn.credentialFields.map((f) => (
            <FormRow key={f.key} label={f.label} htmlFor={`${conn.platform}-${f.key}`} hint={f.secret && conn.credentials[f.key] ? "เว้นว่างเพื่อใช้ค่าเดิม" : undefined}>
              <Input
                id={`${conn.platform}-${f.key}`}
                type={f.secret ? "password" : "text"}
                autoComplete="off"
                value={values[f.key] ?? ""}
                placeholder={conn.credentials[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            </FormRow>
          ))}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              ยกเลิก
            </Button>
            <Button size="sm" variant="primary" loading={busy === "save"} onClick={save}>
              บันทึกแบบเข้ารหัส
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <KeyRound /> {conn.hasCredentials ? "แก้ไข Credentials" : "ตั้งค่า"}
          </Button>
          <Button size="sm" variant="outline" disabled={!conn.hasCredentials} loading={busy === "test"} onClick={test}>
            <PlugZap /> ทดสอบการเชื่อมต่อ
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={conn.status !== "connected"}
            title={conn.status !== "connected" ? "ต้องเชื่อมต่อสำเร็จก่อน" : undefined}
            loading={busy === "sync"}
            onClick={() => run("sync", () => api(`/api/settings/connections/${conn.platform}/sync`, { method: "POST", body: {} }), "ส่งงานซิงก์เข้าคิวแล้ว")}
          >
            <RefreshCw /> ซิงก์สินค้า
          </Button>
          {conn.hasCredentials && (
            <Button
              size="sm"
              variant="ghost"
              loading={busy === "disconnect"}
              onClick={() => confirm("ลบ Credentials และยกเลิกการเชื่อมต่อ?") && run("disconnect", () => api(`/api/settings/connections/${conn.platform}`, { method: "POST", body: { disconnect: true } }), "ยกเลิกการเชื่อมต่อแล้ว")}
            >
              <Unplug /> ยกเลิกการเชื่อมต่อ
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
