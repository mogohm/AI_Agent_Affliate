import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { creativeTemplates } from "@/db/schema";
import { conflict, notFound, parseJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const Config = z.object({
  durationSec: z.number().int().min(8).max(60),
  sceneCount: z.number().int().min(1).max(10),
  structure: z.array(z.enum(["hook", "problem", "solution", "showcase", "benefit", "cta"])).min(1).max(10),
  palette: z.object({ from: z.string().regex(/^#[0-9a-f]{6}$/i), to: z.string().regex(/^#[0-9a-f]{6}$/i), accent: z.string().regex(/^#[0-9a-f]{6}$/i) }),
  music: z.enum(["none", "calm", "upbeat"]),
});
const Style = z.enum(["showcase", "review", "problem_solution", "promo", "three_benefits", "comparison"]);

export const GET = route({ permission: "video:read" }, async ({ db, session, req }) => {
  const all = req.nextUrl.searchParams.get("all") === "1";
  const rows = await db
    .select()
    .from(creativeTemplates)
    .where(all ? eq(creativeTemplates.workspaceId, session.workspaceId) : and(eq(creativeTemplates.workspaceId, session.workspaceId), eq(creativeTemplates.isActive, true)))
    .orderBy(creativeTemplates.key, desc(creativeTemplates.version));
  return { items: rows };
});

const Create = z.object({
  key: z.string().regex(/^[a-z0-9-]{3,60}$/),
  name: z.string().min(1).max(120),
  style: Style,
  description: z.string().max(500).optional(),
  prompt: z.string().min(1).max(4000),
  config: Config,
});

export const POST = route({ permission: "settings:manage" }, async ({ req, db, session, ip }) => {
  const body = await parseJson(req, Create);
  const [exists] = await db.select({ id: creativeTemplates.id }).from(creativeTemplates).where(and(eq(creativeTemplates.workspaceId, session.workspaceId), eq(creativeTemplates.key, body.key))).limit(1);
  if (exists) throw conflict("มี Template key นี้แล้ว");
  const [template] = await db.insert(creativeTemplates).values({ ...body, config: { ...body.config, sceneCount: body.config.structure.length }, workspaceId: session.workspaceId, version: 1 }).returning();
  await audit(db, { workspaceId: session.workspaceId, userId: session.id, action: "template.create", entityType: "creative_template", entityId: template.id, ip });
  return { template };
});

const Patch = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  prompt: z.string().min(1).max(4000).optional(),
  style: Style.optional(),
  config: Config.optional(),
  isActive: z.boolean().optional(),
});

/** Edits are versioned: a new row (version+1) becomes active; the previous version is kept for traceability. */
export const PATCH = route({ permission: "settings:manage" }, async ({ req, db, session, ip }) => {
  const body = await parseJson(req, Patch);
  const [cur] = await db.select().from(creativeTemplates).where(and(eq(creativeTemplates.id, body.id), eq(creativeTemplates.workspaceId, session.workspaceId)));
  if (!cur) throw notFound("Template");
  const onlyToggle = body.isActive !== undefined && Object.keys(body).length === 2;
  if (onlyToggle) {
    const [template] = await db.update(creativeTemplates).set({ isActive: body.isActive!, updatedAt: new Date() }).where(eq(creativeTemplates.id, cur.id)).returning();
    return { template };
  }
  const [latest] = await db.select().from(creativeTemplates).where(and(eq(creativeTemplates.workspaceId, session.workspaceId), eq(creativeTemplates.key, cur.key))).orderBy(desc(creativeTemplates.version)).limit(1);
  await db.update(creativeTemplates).set({ isActive: false, updatedAt: new Date() }).where(and(eq(creativeTemplates.workspaceId, session.workspaceId), eq(creativeTemplates.key, cur.key)));
  const config = body.config ? { ...body.config, sceneCount: body.config.structure.length } : cur.config;
  const [template] = await db
    .insert(creativeTemplates)
    .values({
      workspaceId: session.workspaceId,
      key: cur.key,
      name: body.name ?? cur.name,
      style: body.style ?? cur.style,
      description: body.description ?? cur.description,
      prompt: body.prompt ?? cur.prompt,
      config,
      version: latest.version + 1,
      isActive: body.isActive ?? true,
    })
    .returning();
  await audit(db, { workspaceId: session.workspaceId, userId: session.id, action: "template.version", entityType: "creative_template", entityId: template.id, metadata: { key: cur.key, version: template.version }, ip });
  return { template };
});
