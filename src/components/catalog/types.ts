import type { OfferRow } from "@/lib/catalog/service";

export type OfferListResponse = { items: OfferRow[]; total: number; page: number; pageSize: number };
export type Category = { id: string; name: string; slug: string; keywords: string[]; products: number };
export type Shortlist = { id: string; name: string; count: number; createdAt: string };
export type { OfferRow };
