import { z } from "zod";
import { parseJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { spentUsdSince } from "@/lib/ai/usage";
import { getSetting, setSetting } from "@/lib/settings";
import { startOfBangkokDay, startOfBangkokMonth } from "@/lib/time";
import type { Db } from "@/db/client";

async function view(db: Db, ws: string) {
  const budget = await getSetting(db, ws, "budget");
  const now = new Date();
  const [today, month] = await Promise.all([spentUsdSince(db, ws, startOfBangkokDay(now)), spentUsdSince(db, ws, startOfBangkokMonth(now))]);
  return { budget, spent: { todayUsd: today, monthUsd: month } };
}

export const GET = route({ permission: "settings:read" }, async ({ db, session }) => view(db, session.workspaceId));

const Body = z
  .object({
    dailyUsd: z.number().min(0).max(100_000),
    monthlyUsd: z.number().min(0).max(1_000_000),
    perVideoUsd: z.number().min(0).max(1_000),
    fxThbPerUsd: z.number().min(1).max(200),
  })
  .refine((b) => b.monthlyUsd >= b.dailyUsd, { message: "งบรายเดือนต้องไม่น้อยกว่างบรายวัน", path: ["monthlyUsd"] });

export const PATCH = route({ permission: "settings:manage" }, async ({ db, session, req, ip }) => {
  const b = await parseJson(req, Body);
  await setSetting(db, session.workspaceId, "budget", b, session.id);
  await audit(db, { workspaceId: session.workspaceId, userId: session.id, action: "settings.budget_update", metadata: b, ip });
  return view(db, session.workspaceId);
});
