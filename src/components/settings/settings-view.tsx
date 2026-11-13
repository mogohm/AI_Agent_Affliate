"use client";
import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { PlugZap, Sparkles, Clapperboard, LayoutTemplate, Wallet, Gauge, Users, ScrollText, Server } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeading } from "@/components/page-heading";
import { Badge } from "@/components/ui/badge";
import { useCan } from "@/components/session-context";
import { ConnectionsPanel } from "./connections-panel";
import { AiSettings } from "./ai-settings";
import { VideoSettings } from "./video-settings";
import { TemplatesSettings } from "./templates-settings";
import { BudgetSettings, ScoringSettings } from "./budget-settings";
import { UsersSettings } from "./users-settings";
import { AuditSettings } from "./audit-settings";
import { SystemSettings } from "./system-settings";
import type { SettingsTab } from "./tabs";


export function SettingsView({ initialTab }: { initialTab: SettingsTab }) {
  const router = useRouter();
  const pathname = usePathname();
  const canUsers = useCan("users:manage");
  const canAudit = useCan("audit:read");
  const canManage = useCan("settings:manage");
  const tabs = [
    { key: "connections", label: "Marketplace", icon: PlugZap },
    { key: "ai", label: "AI Providers", icon: Sparkles },
    { key: "video", label: "Video Providers", icon: Clapperboard },
    { key: "templates", label: "Templates", icon: LayoutTemplate },
    { key: "budget", label: "AI Budget", icon: Wallet },
    { key: "scoring", label: "Scoring", icon: Gauge },
    ...(canUsers ? [{ key: "users", label: "Users & Roles", icon: Users }] : []),
    ...(canAudit ? [{ key: "audit", label: "Audit Logs", icon: ScrollText }] : []),
    { key: "system", label: "System", icon: Server },
  ] as const;
  const valid = tabs.some((t) => t.key === initialTab) ? initialTab : "connections";
  const [tab, setTab] = React.useState<string>(valid);

  return (
    <div>
      <PageHeading
        title="Integrations & Admin Settings"
        description="จัดการแหล่งข้อมูล AI Providers บัญชี Affiliate งบประมาณ ผู้ใช้ และความปลอดภัยจากหลังบ้าน — Secret ทั้งหมดเก็บฝั่ง Server เท่านั้น"
        actions={!canManage && <Badge tone="orange">โหมดดูอย่างเดียว — เฉพาะ Admin แก้ไขได้</Badge>}
      />
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v);
          router.replace(`${pathname}?tab=${v}`, { scroll: false });
        }}
      >
        <TabsList>
          {tabs.map((t) => (
            <TabsTrigger key={t.key} value={t.key} className="flex items-center gap-1.5">
              <t.icon className="size-3.5" /> {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="connections">
          <ConnectionsPanel />
        </TabsContent>
        <TabsContent value="ai">
          <AiSettings />
        </TabsContent>
        <TabsContent value="video">
          <VideoSettings />
        </TabsContent>
        <TabsContent value="templates">
          <TemplatesSettings />
        </TabsContent>
        <TabsContent value="budget">
          <BudgetSettings />
        </TabsContent>
        <TabsContent value="scoring">
          <ScoringSettings />
        </TabsContent>
        {canUsers && (
          <TabsContent value="users">
            <UsersSettings />
          </TabsContent>
        )}
        {canAudit && (
          <TabsContent value="audit">
            <AuditSettings />
          </TabsContent>
        )}
        <TabsContent value="system">
          <SystemSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
