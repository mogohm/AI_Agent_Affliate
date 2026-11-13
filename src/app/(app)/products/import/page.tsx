import type { Metadata } from "next";
import { ImportWizard } from "@/components/catalog/import-wizard";
import { requirePageSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "นำเข้าสินค้า" };

export default async function ImportPage() {
  await requirePageSession("products:read");
  return <ImportWizard />;
}
