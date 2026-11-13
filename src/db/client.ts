import path from "node:path";
import fs from "node:fs";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { env, isTrue } from "@/lib/env";

/**
 * A single Drizzle database type for the app. Both drivers (PGlite for local/dev/test and
 * node-postgres for Neon/Postgres) expose the same query-builder API.
 */
export type Db = NodePgDatabase<typeof schema>;

type DbState = { db: Db; close: () => Promise<void>; driver: "pglite" | "pg" };

const g = globalThis as unknown as { __affiliateDb?: Promise<DbState> };

export const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

async function createPglite(url: string): Promise<DbState> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const target = url.replace(/^pglite:\/\//, "");
  let client;
  if (target === "memory" || target === "") {
    client = new PGlite();
  } else {
    const dir = path.resolve(target);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    client = new PGlite(dir);
  }
  const db = drizzle({ client, schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS_DIR });
  return { db, driver: "pglite", close: () => client.close() };
}

async function createPg(url: string): Promise<DbState> {
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pool = new Pool({
    connectionString: url,
    max: Number(process.env.DB_POOL_MAX ?? 5),
    ssl: /sslmode=require|neon\.tech/.test(url) ? { rejectUnauthorized: true } : undefined,
  });
  const db = drizzle({ client: pool, schema });
  if (isTrue(env().DB_AUTO_MIGRATE)) {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  }
  return { db, driver: "pg", close: () => pool.end() };
}

export function createDatabase(url: string): Promise<DbState> {
  return url.startsWith("pglite://") ? createPglite(url) : createPg(url);
}

/** Lazily initialised, process-wide database handle. */
export async function getDb(): Promise<Db> {
  if (!g.__affiliateDb) {
    g.__affiliateDb = createDatabase(env().DATABASE_URL).catch((err) => {
      g.__affiliateDb = undefined;
      throw err;
    });
  }
  return (await g.__affiliateDb).db;
}

export async function getDbDriver(): Promise<"pglite" | "pg"> {
  await getDb();
  return (await g.__affiliateDb!).driver;
}

/** Replace the process database (tests) — returns the previous state's close fn. */
export function __setDbForTests(state: Promise<DbState> | undefined) {
  g.__affiliateDb = state;
}

export async function closeDb() {
  if (g.__affiliateDb) {
    const s = await g.__affiliateDb;
    g.__affiliateDb = undefined;
    await s.close();
  }
}

export { schema };
