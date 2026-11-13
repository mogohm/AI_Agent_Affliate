import type { Metadata } from "next";
import { requirePageSession } from "@/lib/auth/session";
import { StudioHome } from "@/components/studio/studio-home";

export const metadata: Metadata = { title: "AI Video Studio" };

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ offerId?: string; new?: string }> }) {
  await requirePageSession("video:read");
  const sp = await searchParams;
  const offerId = sp.offerId && /^[0-9a-f-]{36}$/i.test(sp.offerId) ? sp.offerId : undefined;
  return <StudioHome initialOfferId={offerId} openNew={sp.new === "1"} />;
}
