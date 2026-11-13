import type { Metadata } from "next";
import { requirePageSession } from "@/lib/auth/session";
import { LibraryGrid } from "@/components/library/library-grid";

export const metadata: Metadata = { title: "Content Library" };

export default async function LibraryPage() {
  await requirePageSession("video:read");
  return <LibraryGrid />;
}
