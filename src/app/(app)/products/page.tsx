import type { Metadata } from "next";
import { Suspense } from "react";
import { ProductExplorer } from "@/components/catalog/product-explorer";
import { LoadingRows } from "@/components/ui/states";
import { requirePageSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "สินค้าและค่าคอม" };

export default async function ProductsPage() {
  await requirePageSession("products:read");
  return (
    <Suspense fallback={<LoadingRows rows={8} />}>
      <ProductExplorer />
    </Suspense>
  );
}
