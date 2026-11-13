import { z } from "zod";
import { parseJson, parseQuery, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { listOffers, SORTS, upsertProductOffer } from "@/lib/catalog/service";
import { rescoreProduct } from "@/lib/catalog/scoring-service";

const num = z.coerce.number().finite();
const Query = z.object({
  search: z.string().max(200).optional(),
  marketplace: z.enum(["shopee", "lazada"]).optional(),
  categoryId: z.string().uuid().optional(),
  origin: z.enum(["demo", "csv", "feed", "manual", "api"]).optional(),
  minPrice: num.min(0).optional(),
  maxPrice: num.min(0).optional(),
  minRate: num.min(0).max(100).optional(),
  minCommission: num.min(0).optional(),
  minScore: num.min(0).max(100).optional(),
  shortlistId: z.string().uuid().optional(),
  duplicatesOnly: z.enum(["1", "true"]).optional(),
  needsReview: z.enum(["1", "true"]).optional(),
  sort: z.enum(Object.keys(SORTS) as [keyof typeof SORTS, ...(keyof typeof SORTS)[]]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

export const GET = route({ permission: "products:read" }, async ({ req, db, session }) => {
  const q = parseQuery(req, Query);
  return listOffers(db, session.workspaceId, {
    ...q,
    duplicatesOnly: !!q.duplicatesOnly,
    needsReview: !!q.needsReview,
  });
});

const optUrl = z.string().url().refine((u) => /^https?:\/\//.test(u), "ต้องเป็น http(s)").optional().nullable().or(z.literal("").transform(() => null));
export const ManualProduct = z.object({
  platform: z.enum(["shopee", "lazada"]),
  externalProductId: z.string().trim().min(1).max(200),
  shopName: z.string().trim().max(300).optional().nullable(),
  shopId: z.string().trim().max(200).optional().nullable(),
  title: z.string().trim().min(2).max(500),
  brand: z.string().trim().max(200).optional().nullable(),
  description: z.string().max(5000).optional().nullable(),
  sourceCategory: z.string().max(300).optional().nullable(),
  categoryId: z.string().uuid().optional().nullable(),
  price: z.number().min(0).max(10_000_000),
  commissionRate: z.number().min(0).max(100).optional().nullable(),
  capAmount: z.number().min(0).optional().nullable(),
  commissionIsEstimated: z.boolean().default(false),
  rating: z.number().min(0).max(5).optional().nullable(),
  soldCount: z.number().int().min(0).optional().nullable(),
  productUrl: optUrl,
  affiliateUrl: optUrl,
  imageUrl: optUrl,
  imageRights: z.enum(["authorized", "unknown", "not_allowed"]).default("unknown"),
});

export const POST = route({ permission: "products:write" }, async ({ req, db, session, ip }) => {
  const body = await parseJson(req, ManualProduct);
  const out = await upsertProductOffer(
    db,
    session.workspaceId,
    { ...body, commissionSource: body.commissionIsEstimated ? "Manual entry (estimated)" : "Manual entry" },
    "manual",
  );
  await rescoreProduct(db, session.workspaceId, out.productId);
  await audit(db, { workspaceId: session.workspaceId, userId: session.id, action: "product.manual_upsert", entityType: "product", entityId: out.productId, metadata: { status: out.status }, ip });
  return out;
});
