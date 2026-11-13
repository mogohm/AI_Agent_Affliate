import type { Metadata } from "next";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { requirePageSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "ภาพรวมธุรกิจ" };

export default async function DashboardPage() {
  await requirePageSession("products:read");
  return <DashboardView />;
}
