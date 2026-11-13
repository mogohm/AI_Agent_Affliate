"use client";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { ErrorState, LoadingRows, Note } from "@/components/ui/states";
import { useApi } from "@/lib/client/api";

type Status = {
  nodeEnv: string;
  db: { driver: string };
  queue: { driver: string; redisConfigured: boolean; inlineWorker: boolean; concurrency: number };
  storage: { driver: string; s3Configured: boolean };
  secrets: { authSecretSet: boolean; encryptionKeySet: boolean };
  media: { ffmpeg: { found: boolean; version: string | null }; fontsReady: boolean };
};

function Row({ ok, label, value, hint }: { ok: boolean; label: string; value: string; hint?: string }) {
  return (
    <li className="flex items-start gap-2 border-b border-line py-2.5 text-xs last:border-0">
      {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />}
      <div className="flex-1">
        <b>{label}</b>: {value}
        {hint && !ok && <div className="text-muted">{hint}</div>}
      </div>
    </li>
  );
}

export function SystemSettings() {
  const r = useApi<Status>("/api/system/status");
  if (r.error) return <ErrorState error={r.error} onRetry={r.reload} />;
  if (!r.data) return <LoadingRows rows={5} />;
  const s = r.data;
  const prod = s.nodeEnv === "production";
  return (
    <Card>
      <CardHeader title="สถานะระบบ" description={`Environment: ${s.nodeEnv}`} />
      <ul>
        <Row ok={!prod || s.db.driver === "pg"} label="Database" value={s.db.driver === "pg" ? "PostgreSQL (Neon)" : "PGlite (local, single process)"} hint="Production ต้องใช้ DATABASE_URL ของ Neon/Postgres" />
        <Row
          ok={s.queue.driver === "db" || s.queue.redisConfigured}
          label="Queue"
          value={`${s.queue.driver === "bullmq" ? "BullMQ + Redis (wake-up) + Postgres (durable)" : "Postgres (polling)"} · concurrency ${s.queue.concurrency}`}
          hint="QUEUE_DRIVER=bullmq ต้องกำหนด REDIS_URL"
        />
        <Row ok={!prod || !s.queue.inlineWorker} label="Worker" value={s.queue.inlineWorker ? "Inline ใน Next.js (dev)" : "Standalone (npm run worker)"} hint="Production: ตั้ง WORKER_INLINE=false และรัน Worker บน VPS" />
        <Row ok={!prod || (s.storage.driver === "s3" && s.storage.s3Configured)} label="Storage" value={s.storage.driver === "s3" ? `S3-compatible ${s.storage.s3Configured ? "" : "(ยังไม่กำหนด S3_BUCKET)"}` : "Local filesystem"} hint="เมื่อ Web อยู่บน Vercel และ Worker อยู่บน VPS ต้องใช้ S3 ร่วมกัน" />
        <Row ok={s.secrets.authSecretSet} label="AUTH_SECRET" value={s.secrets.authSecretSet ? "กำหนดแล้ว" : "ใช้ค่า dev (ไม่ปลอดภัย)"} hint="กำหนด AUTH_SECRET ความยาว ≥ 32 ตัวอักษร" />
        <Row ok={s.secrets.encryptionKeySet} label="APP_ENCRYPTION_KEY" value={s.secrets.encryptionKeySet ? "กำหนดแล้ว" : "สร้างจาก AUTH_SECRET"} hint="แนะนำกำหนดแยกเพื่อหมุนเวียน Key ได้" />
        <Row ok={s.media.ffmpeg.found && s.media.fontsReady} label="Media pipeline" value={`FFmpeg ${s.media.ffmpeg.found ? "พร้อม" : "ไม่พบ"} · ฟอนต์ไทย ${s.media.fontsReady ? "พร้อม" : "ไม่ครบ"}`} />
      </ul>
      <Note className="mt-3">หน้านี้ไม่แสดงค่า Secret ใด ๆ — แสดงเฉพาะสถานะว่ากำหนดแล้วหรือไม่</Note>
    </Card>
  );
}
