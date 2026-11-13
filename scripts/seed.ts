/** Bootstrap workspace/users/categories/templates (+ DEMO data unless SEED_DEMO_DATA=false). Idempotent. */
import { createDatabase, __setDbForTests } from "../src/db/client";
import { env } from "../src/lib/env";
import { ensureBootstrap } from "../src/lib/bootstrap";

async function main() {
  process.env.DB_AUTO_MIGRATE = "true";
  const state = createDatabase(env().DATABASE_URL);
  __setDbForTests(state);
  const s = await state;
  await ensureBootstrap(s.db);
  console.log(`Seed complete. Admin login: ${env().SEED_ADMIN_EMAIL}`);
  await s.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
