import { z } from "zod";

/** Client-safe validation for automation rules. */
const optNum = (max: number) => z.number().min(0).max(max).nullable().optional();

export const RuleConditionsSchema = z.object({
  minCommissionAmount: optNum(1_000_000),
  minCommissionRate: optNum(100),
  minScore: optNum(100),
  minConfidence: optNum(1),
  categoryIds: z.array(z.string().uuid()).max(50).default([]),
  marketplaces: z.array(z.enum(["shopee", "lazada"])).max(2).default([]),
  excludeAlreadyProduced: z.boolean().default(true),
  requireAuthorizedImage: z.boolean().default(false),
});

export const RuleActionsSchema = z.object({
  templateKey: z.string().min(1).max(100),
  language: z.enum(["th", "en"]).default("th"),
  renderMode: z.enum(["hybrid", "generative"]).default("hybrid"),
  videosPerDay: z.number().int().min(1).max(100),
  autoGenerateScript: z.boolean().default(true),
  autoRender: z.boolean().default(false),
  /** Publishing always requires human approval — not configurable. */
  requireApproval: z.literal(true).default(true),
  maxCostPerVideoUsd: z.number().min(0).max(100).nullable().optional(),
});

export const RuleInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(false),
  conditions: RuleConditionsSchema,
  actions: RuleActionsSchema,
  schedule: z.enum(["manual", "daily"]).default("manual"),
  scheduleTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "รูปแบบเวลา HH:mm")
    .default("09:00"),
});

export const RulePatchSchema = RuleInputSchema.partial();

export type RuleInput = z.infer<typeof RuleInputSchema>;
