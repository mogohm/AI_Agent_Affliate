/** Apply SQL migrations in ./drizzle to DATABASE_URL (Neon/Postgres or PGlite). */
import { createDatabase } from "../src/db/client";
import { env } from "../src/lib/env";

async function main() {
  process.env.DB_AUTO_MIGRATE = "true";
  const url = env().DATABASE_URL;
  const s = await createDatabase(url);
  console.log(`Migrations applied (${s.driver}).`);
  await s.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
