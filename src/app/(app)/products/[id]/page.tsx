import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductDetailView } from "@/components/catalog/product-detail";
import { requirePageSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "รายละเอียดสินค้า" };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageSession("products:read");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return <ProductDetailView productId={id} />;
}
