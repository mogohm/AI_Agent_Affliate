import { Badge } from "@/components/ui/badge";
import { CONNECTION_STATUS, JOB_STATUS, ORIGIN_LABEL, PLATFORM_LABEL, VIDEO_STATUS, COMMISSION_STATUS } from "@/lib/labels";
import { cn } from "@/lib/utils";

/** Provenance badge — shown wherever a fact (price, commission, KPI) is displayed. */
export function OriginBadge({ origin, className }: { origin: string | null | undefined; className?: string }) {
  if (!origin) return null;
  const o = ORIGIN_LABEL[origin] ?? { label: origin.toUpperCase(), tone: "muted" as const, hint: "" };
  return (
    <Badge tone={o.tone} title={o.hint} className={cn("px-1.5 py-0.5 text-[10px]", className)}>
      {o.label}
    </Badge>
  );
}

export function PlatformLabel({ platform }: { platform: string }) {
  const p = PLATFORM_LABEL[platform] ?? { label: platform, className: "" };
  return <span className={cn("text-[11px] font-extrabold whitespace-nowrap", p.className)}>● {p.label}</span>;
}

export function VideoStatusBadge({ status }: { status: string }) {
  const s = VIDEO_STATUS[status] ?? { label: status, tone: "muted" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function JobStatusBadge({ status }: { status: string }) {
  const s = JOB_STATUS[status] ?? { label: status, tone: "muted" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function ConnectionBadge({ status }: { status: string }) {
  const s = CONNECTION_STATUS[status] ?? { label: status, tone: "muted" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function CommissionStatusBadge({ status }: { status: string }) {
  const s = COMMISSION_STATUS[status] ?? { label: status, tone: "muted" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
