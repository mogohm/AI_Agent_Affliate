import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb, getDbDriver } from "@/db/client";

export const dynamic = "force-dynamic";

/** Liveness/readiness probe — no secrets, no auth. */
export async function GET() {
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return NextResponse.json({ ok: true, db: await getDbDriver(), time: new Date().toISOString() });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
