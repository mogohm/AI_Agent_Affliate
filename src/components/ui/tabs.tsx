"use client";
import * as React from "react";
import { Tabs as T } from "radix-ui";
import { cn } from "@/lib/utils";

export const Tabs = T.Root;
export const TabsContent = T.Content;

export function TabsList({ className, ...props }: React.ComponentProps<typeof T.List>) {
  return <T.List className={cn("mb-5 flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1", className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        "cursor-pointer rounded-lg px-3 py-2 text-xs font-bold text-muted transition-colors hover:text-fg data-[state=active]:bg-accent data-[state=active]:text-accent-fg",
        className,
      )}
      {...props}
    />
  );
}
