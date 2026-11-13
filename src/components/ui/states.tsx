import * as React from "react";
import { AlertTriangle, Inbox, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-surface-2", className)} />;
}

export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="กำลังโหลด">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line px-6 py-12 text-center", className)}>
      <div className="mb-1 text-muted [&_svg]:size-8">{icon ?? <Inbox />}</div>
      <div className="font-bold">{title}</div>
      {description && <p className="max-w-md text-xs text-muted">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const msg = error instanceof Error ? error.message : typeof error === "string" ? error : "เกิดข้อผิดพลาด";
  return (
    <div role="alert" className={cn("flex items-center gap-3 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm", className)}>
      <AlertTriangle className="size-4 shrink-0 text-danger" />
      <span className="flex-1">{msg}</span>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          ลองใหม่
        </Button>
      )}
    </div>
  );
}

export function Note({ children, className, tone = "info" }: { children: React.ReactNode; className?: string; tone?: "info" | "warn" }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-xl border border-dashed px-3.5 py-2.5 text-xs text-muted",
        tone === "warn" ? "border-warn/50 bg-warn/5" : "border-line bg-[color-mix(in_srgb,var(--accent)_5%,var(--surface))]",
        className,
      )}
    >
      {tone === "warn" ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" /> : <Info className="mt-0.5 size-3.5 shrink-0" />}
      <div className="[&_b]:text-fg">{children}</div>
    </div>
  );
}

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-2", className)} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-[linear-gradient(90deg,var(--accent),var(--accent2))] transition-[width]" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
