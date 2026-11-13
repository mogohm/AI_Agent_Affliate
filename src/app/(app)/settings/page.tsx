import type { Metadata } from "next";
import { requirePageSession } from "@/lib/auth/session";
import { SettingsView } from "@/components/settings/settings-view";
import { SETTINGS_TABS, type SettingsTab } from "@/components/settings/tabs";

export const metadata: Metadata = { title: "ตั้งค่าและเชื่อมต่อ" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requirePageSession("settings:read");
  const { tab } = await searchParams;
  const initial = (SETTINGS_TABS as readonly string[]).includes(tab ?? "") ? (tab as SettingsTab) : "connections";
  return <SettingsView initialTab={initial} />;
}
