/** Asia/Bangkok is UTC+7 with no DST, so day/month boundaries can be computed with a fixed offset. */
const OFFSET_MS = 7 * 60 * 60 * 1000;

export function startOfBangkokDay(d = new Date()): Date {
  const local = new Date(d.getTime() + OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - OFFSET_MS);
}

export function startOfBangkokMonth(d = new Date()): Date {
  const local = new Date(d.getTime() + OFFSET_MS);
  local.setUTCDate(1);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - OFFSET_MS);
}

/** YYYY-MM-DD in Bangkok time. */
export function bangkokDateString(d = new Date()): string {
  return new Date(d.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** HH:mm in Bangkok time. */
export function bangkokTimeString(d = new Date()): string {
  return new Date(d.getTime() + OFFSET_MS).toISOString().slice(11, 16);
}

export function daysAgo(n: number, from = new Date()): Date {
  return new Date(startOfBangkokDay(from).getTime() - n * 86_400_000);
}
