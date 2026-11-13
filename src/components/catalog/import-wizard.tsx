"use client";
import * as React from "react";
import Link from "next/link";
import Papa from "papaparse";
import { CheckCircle2, FileSpreadsheet, Upload, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { FormRow, Input, Select } from "@/components/ui/form";
import { EmptyState, ErrorState, LoadingRows, Note } from "@/components/ui/states";
import { Table, TableWrap, Td, Th, THead, Tr } from "@/components/ui/table";
import { PageHeading } from "@/components/page-heading";
import { useCan } from "@/components/session-context";
import { api, useApi } from "@/lib/client/api";
import { autoMapColumns, IMPORT_FIELDS, mapAndValidateRow, MAX_IMPORT_ROWS, missingRequiredFields, type ColumnMapping, type ImportField } from "@/lib/catalog/csv";
import { dateTime, num, thb } from "@/lib/format";
import { cn } from "@/lib/utils";

type Parsed = { fileName: string; headers: string[]; rows: Record<string, unknown>[] };
type Summary = { runId: string; status: string; totalRows: number; inserted: number; updated: number; merged: number; possibleDuplicates: number; failed: number; errors: { row: number; message: string }[] };
type Run = { id: string; status: string; fileName: string | null; totalRows: number; inserted: number; updated: number; duplicates: number; failed: number; createdAt: string; sourceName: string | null; sourceType: string | null; createdBy: string | null };

const SAMPLE = `Item Id,Product Name,Price,Commission Rate,Commission Cap,Shop Name,Category,Sales,Item Rating,Product Link,Offer Link
1001,หูฟังบลูทูธ True Wireless,1290,10.5%,,My Gadget Shop,อุปกรณ์อิเล็กทรอนิกส์,8900,4.7,https://shopee.co.th/product/1/1001,
1002,ไฟวงแหวน 10 นิ้ว พร้อมขาตั้ง,890,12%,100,Creator Store,อุปกรณ์ครีเอเตอร์,5300,4.8,https://shopee.co.th/product/2/1002,`;

const RUN_STATUS: Record<string, { label: string; tone: "green" | "orange" | "rose" | "muted" }> = {
  completed: { label: "สำเร็จ", tone: "green" },
  completed_with_errors: { label: "สำเร็จบางส่วน", tone: "orange" },
  failed: { label: "ล้มเหลว", tone: "rose" },
  running: { label: "กำลังทำงาน", tone: "orange" },
  pending: { label: "รอ", tone: "muted" },
};

export function ImportWizard() {
  const canWrite = useCan("products:write");
  const runs = useApi<{ items: Run[] }>("/api/ingestion/runs");
  const [parsed, setParsed] = React.useState<Parsed | null>(null);
  const [parseError, setParseError] = React.useState<string | null>(null);
  const [mapping, setMapping] = React.useState<ColumnMapping>({});
  const [origin, setOrigin] = React.useState<"csv" | "feed">("csv");
  const [defaultPlatform, setDefaultPlatform] = React.useState<"" | "shopee" | "lazada">("shopee");
  const [estimated, setEstimated] = React.useState(false);
  const [imagesAuthorized, setImagesAuthorized] = React.useState(false);
  const [authorized, setAuthorized] = React.useState(false);
  const [sourceName, setSourceName] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<Summary | null>(null);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const load = (text: string, fileName: string) => {
    setResult(null);
    setSubmitError(null);
    const r = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
    const headers = (r.meta.fields ?? []).filter(Boolean);
    if (!headers.length || !r.data.length) {
      setParseError("ไม่พบหัวคอลัมน์หรือข้อมูลในไฟล์ — ตรวจสอบว่าเป็น CSV ที่มีแถวหัวตาราง");
      setParsed(null);
      return;
    }
    if (r.data.length > MAX_IMPORT_ROWS) {
      setParseError(`ไฟล์มี ${num(r.data.length)} แถว เกินขีดจำกัด ${num(MAX_IMPORT_ROWS)} แถวต่อครั้ง — กรุณาแบ่งไฟล์`);
      setParsed(null);
      return;
    }
    setParseError(r.errors.length ? `อ่านไฟล์ได้ แต่มีคำเตือน ${r.errors.length} จุด (เช่น ${r.errors[0].message} แถว ${(r.errors[0].row ?? 0) + 2})` : null);
    setParsed({ fileName, headers, rows: r.data });
    setMapping(autoMapColumns(headers));
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) return setParseError("ไฟล์ใหญ่เกิน 15MB");
    load(await file.text(), file.name);
  };

  const preview = React.useMemo(() => {
    if (!parsed) return null;
    const results = parsed.rows.map((row) => mapAndValidateRow(row, mapping, { defaultPlatform: defaultPlatform || undefined }));
    return { results, valid: results.filter((r) => r.ok).length };
  }, [parsed, mapping, defaultPlatform]);

  const missing = missingRequiredFields(mapping);
  const usedFields = new Set(Object.values(mapping).filter(Boolean));

  const submit = async () => {
    if (!parsed) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const r = await api<Summary>("/api/ingestion/imports", {
        method: "POST",
        body: {
          rows: parsed.rows,
          mapping,
          fileName: parsed.fileName,
          origin,
          defaultPlatform: defaultPlatform || undefined,
          commissionIsEstimated: estimated,
          imageRightsAuthorized: imagesAuthorized,
          sourceName: sourceName || null,
          authorizationConfirmed: authorized,
        },
      });
      setResult(r);
      toast.success(`นำเข้าเสร็จ: ใหม่ ${r.inserted} · อัปเดต ${r.updated} · ล้มเหลว ${r.failed}`);
      runs.reload();
    } catch (e) {
      setSubmitError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeading
        title="นำเข้าสินค้า (CSV / Product Feed)"
        description="ใช้ไฟล์ที่ได้รับอนุญาต เช่น Product Feed จาก Shopee Affiliate หรือไฟล์ส่งออกจาก Lazada Affiliate — ระบบไม่ดึงข้อมูลด้วยการ scrape"
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/products">← กลับไปหน้าสินค้า</Link>
          </Button>
        }
      />

      {!canWrite && <Note tone="warn" className="mb-4">บัญชีของคุณดูประวัติการนำเข้าได้อย่างเดียว (ต้องเป็น Admin/Editor เพื่อนำเข้า)</Note>}

      {canWrite && (
        <Card className="mb-5">
          <CardHeader title="1. เลือกไฟล์" description={`รองรับ .csv (UTF-8) สูงสุด ${num(MAX_IMPORT_ROWS)} แถวต่อครั้ง`} />
          <label
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line px-6 py-8 text-center hover:border-accent"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void onFile(e.dataTransfer.files[0]);
            }}
          >
            <FileSpreadsheet className="size-8 text-muted" />
            <span className="font-bold">{parsed ? parsed.fileName : "ลากไฟล์มาวาง หรือคลิกเพื่อเลือกไฟล์"}</span>
            {parsed && <span className="text-xs text-muted">{num(parsed.rows.length)} แถว · {parsed.headers.length} คอลัมน์</span>}
            <input type="file" accept=".csv,text/csv" className="sr-only" data-testid="csv-input" onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>ไม่มีไฟล์?</span>
            <Button size="sm" variant="ghost" onClick={() => load(SAMPLE, "sample-template.csv")}>
              ใช้ไฟล์ตัวอย่าง (โครงสร้าง)
            </Button>
            <a
              className="underline hover:text-fg"
              href={`data:text/csv;charset=utf-8,${encodeURIComponent("﻿" + SAMPLE)}`}
              download="affiliate-product-template.csv"
            >
              ดาวน์โหลดเทมเพลต CSV
            </a>
          </div>
          {parseError && <ErrorState error={parseError} className="mt-3" />}
        </Card>
      )}

      {canWrite && parsed && preview && (
        <>
          <Card className="mb-5">
            <CardHeader
              title="2. จับคู่คอลัมน์ (Mapping preview)"
              description="ระบบเดาการจับคู่จากชื่อหัวคอลัมน์ (ไทย/อังกฤษ/Shopee feed) — ตรวจสอบและแก้ไขได้"
              actions={missing.length ? <Badge tone="rose">ยังขาด: {missing.map((m) => IMPORT_FIELDS.find((f) => f.key === m)?.label).join(", ")}</Badge> : <Badge tone="green">ครบฟิลด์ที่จำเป็น</Badge>}
            />
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {parsed.headers.map((h) => (
                <div key={h} className="rounded-xl border border-line bg-surface-2 p-2.5">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-bold" title={h}>
                      {h}
                    </span>
                    <span className="truncate text-[10px] text-muted">เช่น {String(parsed.rows[0]?.[h] ?? "").slice(0, 24) || "—"}</span>
                  </div>
                  <Select
                    aria-label={`ฟิลด์สำหรับคอลัมน์ ${h}`}
                    value={mapping[h] ?? ""}
                    onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value as ImportField | "" }))}
                    className="py-1.5 text-xs"
                  >
                    <option value="">— ไม่นำเข้า —</option>
                    {IMPORT_FIELDS.map((f) => (
                      <option key={f.key} value={f.key} disabled={usedFields.has(f.key) && mapping[h] !== f.key}>
                        {f.label}
                        {f.required ? " *" : ""}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
          </Card>

          <Card className="mb-5">
            <CardHeader
              title="3. ตรวจสอบข้อมูลตัวอย่าง"
              description={`ผ่าน ${num(preview.valid)} / ${num(parsed.rows.length)} แถว (Server จะตรวจซ้ำอีกครั้งตอนนำเข้า)`}
            />
            <TableWrap>
              <Table className="min-w-[720px]">
                <THead>
                  <tr>
                    <Th>แถว</Th>
                    <Th>สถานะ</Th>
                    <Th>แพลตฟอร์ม</Th>
                    <Th>รหัส</Th>
                    <Th>ชื่อสินค้า</Th>
                    <Th className="text-right">ราคา</Th>
                    <Th className="text-right">คอม %</Th>
                  </tr>
                </THead>
                <tbody>
                  {preview.results.slice(0, 15).map((r, i) => (
                    <Tr key={i}>
                      <Td>{i + 2}</Td>
                      <Td>
                        {r.ok ? (
                          <CheckCircle2 className="size-4 text-good" aria-label="ผ่าน" />
                        ) : (
                          <span className="flex items-start gap-1 text-danger">
                            <XCircle className="mt-0.5 size-4 shrink-0" /> <span className="text-[11px]">{r.error}</span>
                          </span>
                        )}
                      </Td>
                      <Td>{r.ok ? r.value.platform : "—"}</Td>
                      <Td>{r.ok ? r.value.externalProductId : "—"}</Td>
                      <Td className="max-w-[280px] truncate">{r.ok ? r.value.title : String(Object.values(parsed.rows[i])[1] ?? "")}</Td>
                      <Td className="text-right">{r.ok ? thb(r.value.price) : "—"}</Td>
                      <Td className="text-right">{r.ok ? (r.value.commissionRate ?? <span className="text-muted">ไม่มี</span>) : "—"}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
            {parsed.rows.length > 15 && <p className="mt-2 text-[11px] text-muted">แสดง 15 แถวแรก</p>}
          </Card>

          <Card className="mb-5">
            <CardHeader title="4. แหล่งที่มาและสิทธิ์การใช้ข้อมูล" />
            <div className="grid gap-x-4 sm:grid-cols-3">
              <FormRow label="ประเภทแหล่งข้อมูล" htmlFor="imp-origin">
                <Select id="imp-origin" value={origin} onChange={(e) => setOrigin(e.target.value as "csv" | "feed")}>
                  <option value="csv">CSV ที่เตรียมเอง / ส่งออก</option>
                  <option value="feed">Product Feed อย่างเป็นทางการ</option>
                </Select>
              </FormRow>
              <FormRow label="แพลตฟอร์มเริ่มต้น (ถ้าไฟล์ไม่มีคอลัมน์ platform)" htmlFor="imp-platform">
                <Select id="imp-platform" value={defaultPlatform} onChange={(e) => setDefaultPlatform(e.target.value as "" | "shopee" | "lazada")}>
                  <option value="shopee">Shopee</option>
                  <option value="lazada">Lazada</option>
                  <option value="">ไม่กำหนด (ต้องมีในไฟล์)</option>
                </Select>
              </FormRow>
              <FormRow label="ชื่อแหล่งข้อมูล (ไม่บังคับ)" htmlFor="imp-src">
                <Input id="imp-src" placeholder="เช่น Shopee Feed พ.ย. 2026" value={sourceName} onChange={(e) => setSourceName(e.target.value)} />
              </FormRow>
            </div>
            <div className="space-y-2 text-xs">
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={estimated} onChange={(e) => setEstimated(e.target.checked)} />
                อัตราค่าคอมในไฟล์นี้เป็น <b>ค่าประมาณ</b> (ไม่ได้มาจากบัญชี Affiliate โดยตรง)
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={imagesAuthorized} onChange={(e) => setImagesAuthorized(e.target.checked)} />
                ได้รับอนุญาตให้ใช้ภาพสินค้าในไฟล์นี้สำหรับทำวิดีโอ (ถ้าไม่แน่ใจ ให้เว้นไว้ — ภาพจะถูกตั้งเป็น &ldquo;ยังไม่ยืนยันสิทธิ์&rdquo;)
              </label>
              <label className="flex items-start gap-2 rounded-xl border border-warn/40 bg-warn/5 p-2.5">
                <input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} data-testid="authorize-checkbox" />
                <span>
                  <b>ฉันยืนยันว่าได้รับอนุญาตให้ใช้ข้อมูลนี้</b> (ดาวน์โหลดจากบัญชี Affiliate ของเรา หรือได้รับสิทธิ์จากเจ้าของข้อมูล) และไม่ได้มาจากการ scrape
                </span>
              </label>
            </div>
            {submitError && <ErrorState error={submitError} className="mt-4" />}
            <div className="mt-4 flex justify-end">
              <Button variant="primary" onClick={submit} loading={submitting} disabled={!authorized || missing.length > 0 || preview.valid === 0}>
                <Upload /> นำเข้า {num(preview.valid)} แถวที่ผ่าน
              </Button>
            </div>
          </Card>
        </>
      )}

      {result && (
        <Card className="mb-5 border-accent/50" data-testid="import-result">
          <CardHeader title="ผลการนำเข้า" actions={<Badge tone={RUN_STATUS[result.status]?.tone ?? "muted"}>{RUN_STATUS[result.status]?.label ?? result.status}</Badge>} />
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
            {[
              ["เพิ่มใหม่", result.inserted],
              ["อัปเดต", result.updated],
              ["รวมกับสินค้าเดิม", result.merged],
              ["อาจซ้ำ (รอยืนยัน)", result.possibleDuplicates],
              ["ล้มเหลว", result.failed],
            ].map(([l, v]) => (
              <div key={l as string} className="rounded-xl border border-line bg-surface-2 px-3 py-2.5">
                <div className="text-xl font-extrabold">{num(v as number)}</div>
                <div className="text-[11px] text-muted">{l}</div>
              </div>
            ))}
          </div>
          {result.errors.length > 0 && (
            <div className="mt-4 max-h-56 overflow-auto rounded-xl border border-line text-xs">
              {result.errors.map((e, i) => (
                <div key={i} className="flex gap-3 border-b border-line px-3 py-1.5 last:border-0">
                  <span className="w-14 shrink-0 text-muted">แถว {e.row}</span>
                  <span>{e.message}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild variant="primary" size="sm">
              <Link href="/products?sort=commission_amount">ดูสินค้าเรียงตามค่าคอม ↗</Link>
            </Button>
            {result.possibleDuplicates > 0 && (
              <Button asChild variant="outline" size="sm">
                <Link href="/products?duplicatesOnly=1">ตรวจสอบสินค้าที่อาจซ้ำ</Link>
              </Button>
            )}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="ประวัติการนำเข้า" description="Ingestion runs ล่าสุด 50 รายการ" actions={<Button size="sm" variant="ghost" onClick={runs.reload}>รีเฟรช</Button>} />
        {runs.error ? (
          <ErrorState error={runs.error} onRetry={runs.reload} />
        ) : runs.loading && !runs.data ? (
          <LoadingRows rows={3} />
        ) : !runs.data?.items.length ? (
          <EmptyState title="ยังไม่มีการนำเข้า" className="py-8" />
        ) : (
          <TableWrap>
            <Table className="min-w-[720px]">
              <THead>
                <tr>
                  <Th>เวลา</Th>
                  <Th>ไฟล์ / แหล่ง</Th>
                  <Th>สถานะ</Th>
                  <Th className="text-right">ทั้งหมด</Th>
                  <Th className="text-right">ใหม่</Th>
                  <Th className="text-right">อัปเดต</Th>
                  <Th className="text-right">อาจซ้ำ</Th>
                  <Th className="text-right">ล้มเหลว</Th>
                  <Th>โดย</Th>
                </tr>
              </THead>
              <tbody>
                {runs.data.items.map((r) => (
                  <Tr key={r.id}>
                    <Td className="whitespace-nowrap">{dateTime(r.createdAt)}</Td>
                    <Td>
                      <div className="font-bold">{r.fileName ?? "—"}</div>
                      <div className="text-[11px] text-muted">
                        {r.sourceName} {r.sourceType && <span className="uppercase">· {r.sourceType}</span>}
                      </div>
                    </Td>
                    <Td>
                      <Badge tone={RUN_STATUS[r.status]?.tone ?? "muted"}>{RUN_STATUS[r.status]?.label ?? r.status}</Badge>
                    </Td>
                    <Td className="text-right">{num(r.totalRows)}</Td>
                    <Td className="text-right">{num(r.inserted)}</Td>
                    <Td className="text-right">{num(r.updated)}</Td>
                    <Td className="text-right">{num(r.duplicates)}</Td>
                    <Td className={cn("text-right", r.failed > 0 && "text-danger")}>{num(r.failed)}</Td>
                    <Td>{r.createdBy ?? "ระบบ"}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
