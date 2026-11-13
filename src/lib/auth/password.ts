import bcrypt from "bcryptjs";

/** Password hashing without Next.js server imports (usable from scripts/tests). */
export function hashPasswordRaw(password: string) {
  return bcrypt.hash(password, 10);
}

export function verifyPasswordRaw(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}
