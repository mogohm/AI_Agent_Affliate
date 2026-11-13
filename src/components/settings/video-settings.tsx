"use client";
import * as React from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FormRow, Input } from "@/components/ui/form";
import { SwitchRow } from "@/components/ui/switch";
import { ErrorState, LoadingRows, Note } from "@/components/ui/states";
import { useCan } from "@/components/session-context";
import { api, useApi } from "@/lib/client/api";

type VideoView = {
  providers: { generativeEnabled: boolean; provider: string; maxClipSeconds: number };
  aiMode: "demo" | "live";
  aiReason: string | null;
  videoModel: string;
  media: {
    ffmpeg: { found: boolean; path: string | null; version: string | null };
    fonts: { file: string; present: boolean }[];
    fontsReady: boolean;
    render: { width: number; height: number; fps: number };
  };
};

const Ok = ({ ok }: { ok: boolean }) => (ok ? <CheckCircle2 className="size-4 text-good" /> : <XCircle className="size-4 text-danger" />);

export function VideoSettings() {
  const canManage = useCan("settings:manage");
  const r = useApi<VideoView>("/api/settings/video");
  const [secs, setSecs] = React.useState<string>("");
  const [busy, setBusy] = React.useState(false);

  const save = async (body: Record<string, unknown>, msg: string) => {
    setBusy(true);
    try {
      await api("/api/settings/video", { method: "PATCH", body });
      toast.success(msg);
      await r.reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (r.error) return <ErrorState error={r.error} onRetry={r.reload} />;
  if (!r.data) return <LoadingRows rows={4} />;
  const d = r.data;
  const m = d.media;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader title="Hybrid Rendering (ค่าเริ่มต้น)" description="ภาพสินค้าที่มีสิทธิ์ + Motion + ซับไตเติลไทย → FFmpeg บน Worker" actions={<Badge tone={m.ffmpeg.found && m.fontsReady ? "green" : "rose"}>{m.ffmpeg.found && m.fontsReady ? "พร้อมใช้งาน" : "ไม่พร้อม"}</Badge>} />
        <ul className="space-y-2 text-xs">
          <li className="flex items-center gap-2">
            <Ok ok={m.ffmpeg.found} /> FFmpeg {m.ffmpeg.found ? <span className="text-muted">({m.ffmpeg.path}) {m.ffmpeg.version}</span> : <span className="text-danger">ไม่พบ — ติดตั้ง ffmpeg-static หรือกำหนด FFMPEG_PATH</span>}
          </li>
          {m.fonts.map((f) => (
            <li key={f.file} className="flex items-center gap-2">
              <Ok ok={f.present} /> ฟอนต์ไทย {f.file} <span className="text-muted">(OFL)</span>
            </li>
          ))}
          <li className="text-muted">
            ความละเอียดเรนเดอร์ {m.render.width}×{m.render.height} @ {m.render.fps}fps (ปรับได้ด้วย RENDER_WIDTH/HEIGHT/FPS)
          </li>
        </ul>
      </Card>
      <Card>
        <CardHeader title="Generative AI Video" description={`ผู้ให้บริการ: OpenAI · Model: ${d.videoModel}`} actions={<Badge tone={d.providers.generativeEnabled ? "green" : "muted"}>{d.providers.generativeEnabled ? "เปิดใช้งาน" : "ปิด"}</Badge>} />
        {d.aiMode !== "live" && <Note className="mb-3">ต้องเปิด Live AI และกำหนด API Key ก่อน จึงจะเปิดโหมด Generative ได้ ({d.aiReason})</Note>}
        <SwitchRow
          id="gen-video"
          title="อนุญาตการสร้าง B-roll ด้วย AI Video"
          description="AI video อาจบิดเบือนรูปทรง/ข้อความของสินค้า — ต้องผ่าน QA โดยคนทุกครั้ง และวางภาพสินค้าจริงทับเพื่อความถูกต้อง"
          checked={d.providers.generativeEnabled}
          disabled={!canManage || busy || (d.aiMode !== "live" && !d.providers.generativeEnabled)}
          onCheckedChange={(v) => save({ generativeEnabled: v }, v ? "เปิด Generative AI Video แล้ว" : "ปิด Generative AI Video แล้ว")}
        />
        <FormRow label="ความยาวคลิป AI สูงสุดต่อฉาก (วินาที)" htmlFor="gen-secs" className="mt-3">
          <div className="flex gap-2">
            <Input id="gen-secs" type="number" min={2} max={20} placeholder={String(d.providers.maxClipSeconds)} value={secs} disabled={!canManage} onChange={(e) => setSecs(e.target.value)} />
            {canManage && (
              <Button variant="outline" disabled={!secs} loading={busy} onClick={() => save({ maxClipSeconds: Number(secs) }, "บันทึกแล้ว")}>
                บันทึก
              </Button>
            )}
          </div>
        </FormRow>
      </Card>
    </div>
  );
}
