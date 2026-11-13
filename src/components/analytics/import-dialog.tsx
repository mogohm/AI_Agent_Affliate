"use client";
import * as React from "react";
import Papa from "papaparse";
import { Upload, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormRow, Select } from "@/components/ui/form";
import { ErrorState, Note } from "@/components/ui/states";
import { Table, TableWrap, THead, Th, Td, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/client/api";
import { applyMapping, autoMapHeaders, CLICK_FIELDS, ORDER_FIELDS } from "@/lib/analytics/import-fields";

type Result = { runId: string; totalRows: number; inserted: number; updated: number; failed: number; errors: { row: number; message: string }[]; status: string };

export function AnalyticsImport({ onDone }: { onDone: () => void }) {
  const [kind, setKind] = React.useState<"orders" | "clicks">("orders");
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [headers, setHeaders] = React.useState<string[]>([]);
  const [rawRows, setRawRows] = React.useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = React.useState<Record<string, string>>({});
  const [defaultPlatform, setDefaultPlatform] = React.useState<"" | "shopee" | "lazada">("");
  const [confirm, setConfirm] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<Result | null>(null);
  const fields = kind === "orders" ? ORDER_FIELDS : CLICK_FIELDS;

  const onFile = (file: File) => {
    setError(null);
    setResult(null);
    setFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const hs = res.meta.fields ?? [];
        if (!hs.length || !res.data.length) {
          setError("ไม่พบข้อมูลในไฟล์ CSV (ต้องมีแถวหัวตาราง)");
          return;
        }
        setHeaders(hs);
        setRawRows(res.data);
        setMapping(autoMapHeaders(hs, kind === "orders" ? ORDER_FIELDS : CLICK_FIELDS));
      },
      error: (e) => setError(`อ่านไฟล์ไม่ได้: ${e.message}`),
    });
  };

  const changeKind = (k: "orders" | "clicks") => {
    setKind(k);
    if (headers.length) setMapping(autoMapHeaders(headers, k === "orders" ? ORDER_FIELDS : CLICK_FIELDS));
    setResult(null);
  };

  const missing = fields.filter((f) => f.required && !mapping[f.key]);
  const needsPlatform = !mapping.platform && !defaultPlatform;
  const preview = applyMapping(rawRows.slice(0, 5), mapping);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const rows = applyMapping(rawRows, mapping);
      const r = await api<Result>("/api/analytics/import", {
        method: "POST",
        body: { kind, rows, fileName, mapping, defaultPlatform: defaultPlatform || undefined, confirmAuthorized: true },
      });
      setResult(r);
      toast.success(`นำเข้าแล้ว: เพิ่ม ${r.inserted} · อัปเดต ${r.updated} · ไม่ผ่าน ${r.failed}`);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Note>
        นำเข้า <b>รายงานจริง</b> ที่ Export จาก Shopee/Lazada Affiliate Dashboard เท่านั้น — ระบบไม่สร้างหรือประมาณยอดขาย/คลิกขึ้นเอง ข้อมูลที่นำเข้าจะติดป้าย CSV และนำเข้าซ้ำได้ (อัปเดตสถานะ pending → approved → paid / reversed)
      </Note>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormRow label="ประเภทรายงาน" htmlFor="imp-kind" className="mb-0">
          <Select id="imp-kind" value={kind} onChange={(e) => changeKind(e.target.value as "orders" | "clicks")}>
            <option value="orders">Conversion / Orders report</option>
            <option value="clicks">Click report</option>
          </Select>
        </FormRow>
        <FormRow label="ไฟล์ CSV" htmlFor="imp-file" className="mb-0">
          <label className="flex cursor-pointer items-center gap-2 rounded-[11px] border border-dashed border-line px-3 py-2.5 text-sm text-muted hover:border-accent">
            <Upload className="size-4" />
            <span className="truncate">{fileName ?? "เลือกไฟล์ .csv"}</span>
            <input id="imp-file" type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
        </FormRow>
      </div>

      {headers.length > 0 && (
        <>
          <div>
            <h3 className="mb-2 text-xs font-bold">จับคู่คอลัมน์ (ตรวจอัตโนมัติจากหัวตาราง — แก้ไขได้)</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {fields.map((f) => (
                <label key={f.key} className="flex items-center gap-2 text-xs">
                  <span className="w-36 shrink-0">
                    {f.label}
                    {f.required && <span className="text-danger"> *</span>}
                  </span>
                  <Select aria-label={f.label} value={mapping[f.key] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))} className="py-1.5 text-xs">
                    <option value="">— ไม่ใช้ —</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </Select>
                </label>
              ))}
            </div>
            {!mapping.platform && (
              <FormRow label="Platform เริ่มต้น (เมื่อไฟล์ไม่มีคอลัมน์ Platform)" htmlFor="imp-plat" className="mt-3 mb-0">
                <Select id="imp-plat" value={defaultPlatform} onChange={(e) => setDefaultPlatform(e.target.value as "" | "shopee" | "lazada")}>
                  <option value="">— เลือก —</option>
                  <option value="shopee">Shopee</option>
                  <option value="lazada">Lazada</option>
                </Select>
              </FormRow>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-xs font-bold">
              ตัวอย่าง 5 แถวแรกหลังจับคู่ <span className="font-normal text-muted">(ทั้งหมด {rawRows.length} แถว)</span>
            </h3>
            <TableWrap className="rounded-xl">
              <Table className="min-w-[560px]">
                <THead>
                  <tr>
                    {fields.filter((f) => mapping[f.key]).map((f) => (
                      <Th key={f.key}>{f.label}</Th>
                    ))}
                  </tr>
                </THead>
                <tbody>
                  {preview.map((r, i) => (
                    <Tr key={i}>
                      {fields.filter((f) => mapping[f.key]).map((f) => (
                        <Td key={f.key}>{r[f.key] || <span className="text-muted">—</span>}</Td>
                      ))}
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          </div>

          {missing.length > 0 && <ErrorState error={`ยังไม่ได้จับคู่ฟิลด์ที่จำเป็น: ${missing.map((m) => m.label).join(", ")}`} />}
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5" />
            ยืนยันว่ารายงานนี้มาจากบัญชี Affiliate ของเรา และได้รับอนุญาตให้นำมาใช้วิเคราะห์
          </label>
        </>
      )}

      {error && <ErrorState error={error} />}

      {result && (
        <div className="rounded-xl border border-line bg-surface-2 p-3 text-xs">
          <div className="mb-2 flex items-center gap-2 font-bold">
            <CheckCircle2 className="size-4 text-good" /> ผลการนำเข้า
            <Badge tone={result.status === "completed" ? "green" : result.status === "failed" ? "rose" : "orange"}>{result.status}</Badge>
          </div>
          <div>
            ทั้งหมด {result.totalRows} · เพิ่มใหม่ {result.inserted} · อัปเดต {result.updated} · ไม่ผ่าน {result.failed}
          </div>
          {result.errors.length > 0 && (
            <ul className="mt-2 max-h-40 space-y-0.5 overflow-auto text-danger">
              {result.errors.slice(0, 50).map((e) => (
                <li key={e.row}>
                  แถว {e.row}: {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <Button variant="primary" disabled={!headers.length || missing.length > 0 || needsPlatform || !confirm} loading={busy} onClick={submit}>
          <Upload /> นำเข้า {rawRows.length ? `${rawRows.length} แถว` : ""}
        </Button>
      </div>
    </div>
  );
}
