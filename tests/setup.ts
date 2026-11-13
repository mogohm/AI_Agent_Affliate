import os from "node:os";
import path from "node:path";

// Isolated, deterministic environment for unit/integration tests. No real network or paid APIs.
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: "pglite://memory",
  AUTH_SECRET: "test-secret-test-secret-test-secret-0123456789",
  LOCAL_STORAGE_DIR: path.join(os.tmpdir(), `aas-test-storage-${process.pid}`),
  STORAGE_DRIVER: "local",
  QUEUE_DRIVER: "db",
  WORKER_INLINE: "false",
  OPENAI_API_KEY: "",
  SEED_ADMIN_EMAIL: "admin@example.com",
  SEED_ADMIN_PASSWORD: "ChangeMe!2026",
});

