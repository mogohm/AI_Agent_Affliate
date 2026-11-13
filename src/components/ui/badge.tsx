import * as React from "react";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/labels";

const tones: Record<Tone, string> = {
  default: "bg-accent/15 text-accent-2",
  green: "bg-good/15 text-good",
  orange: "bg-warn/15 text-warn",
  rose: "bg-danger/15 text-danger",
  muted: "bg-surface-2 text-muted",
  blue: "bg-accent-2/15 text-accent-2",
};

export function Badge({ tone = "default", className, ...props }: React.ComponentProps<"span"> & { tone?: Tone }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-[9px] px-2 py-1 text-[11px] leading-none font-bold whitespace-nowrap", tones[tone], className)}
      {...props}
    />
  );
}
