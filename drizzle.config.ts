import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // Only needed for `drizzle-kit push/studio` against a real Postgres (e.g. Neon).
  // Migrations are generated offline and applied by `npm run db:migrate` / app startup.
  dbCredentials: process.env.DATABASE_URL?.startsWith("postgres")
    ? { url: process.env.DATABASE_URL }
    : { url: "postgres://localhost:5432/placeholder" },
});
