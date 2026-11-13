import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("min-w-0 rounded-card border border-line bg-surface p-5 shadow-card", className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-4 flex items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="text-base font-bold tracking-tight">{title}</h2>
        {description && <div className="mt-0.5 text-xs text-muted">{description}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatBubble({ value, label, className }: { value: React.ReactNode; label: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-line bg-surface px-4 py-3", className)}>
      <strong className="text-xl text-accent-2">{value}</strong>
      <span className="block text-[11px] text-muted">{label}</span>
    </div>
  );
}

export function KpiCard({
  label,
  value,
  hint,
  icon,
  tone = "good",
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: "good" | "muted" | "warn";
  className?: string;
}) {
  return (
    <Card className={cn("relative", className)}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] text-muted">{label}</span>
        {icon && <span className="text-muted [&_svg]:size-5">{icon}</span>}
      </div>
      <div className="mt-3 mb-1.5 text-[28px] leading-tight font-extrabold tracking-tight">{value}</div>
      {hint && (
        <div className={cn("text-[11px] font-semibold", tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : "text-muted")}>{hint}</div>
      )}
    </Card>
  );
}
