import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { StudioEditor } from "@/components/studio/studio-editor";

export const metadata: Metadata = { title: "Video Project" };

export default async function StudioProjectPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageSession("video:read");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return <StudioEditor id={id} />;
}
