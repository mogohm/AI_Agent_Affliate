import type { Metadata } from "next";
import { requirePageSession } from "@/lib/auth/session";
import { AnalyticsView } from "@/components/analytics/analytics-view";

export const metadata: Metadata = { title: "รายได้และวิเคราะห์" };

export default async function AnalyticsPage() {
  await requirePageSession("analytics:read");
  return <AnalyticsView />;
}
