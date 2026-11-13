import type { Metadata } from "next";
import { requirePageSession } from "@/lib/auth/session";
import { AutomationView } from "@/components/automation/automation-view";

export const metadata: Metadata = { title: "Automation Factory" };

export default async function AutomationPage() {
  await requirePageSession("automation:read");
  return <AutomationView />;
}
