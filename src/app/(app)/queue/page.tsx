import type { Metadata } from "next";
import { requirePageSession } from "@/lib/auth/session";
import { QueueView } from "@/components/queue/queue-view";

export const metadata: Metadata = { title: "คิวงาน" };

export default async function QueuePage() {
  await requirePageSession("video:read");
  return <QueueView />;
}
