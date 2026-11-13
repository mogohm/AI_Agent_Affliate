/** SubRip subtitle generation from scene timings. */
export type Cue = { start: number; end: number; text: string };

export function srtTimestamp(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

/** Sequential cues from scene durations (seconds). Empty texts are skipped but still consume time. */
export function cuesFromScenes(scenes: { durationSec: number; text: string }[]): Cue[] {
  const cues: Cue[] = [];
  let t = 0;
  for (const s of scenes) {
    const end = t + s.durationSec;
    if (s.text.trim()) cues.push({ start: t, end, text: s.text.trim() });
    t = end;
  }
  return cues;
}

export function buildSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${srtTimestamp(c.start)} --> ${srtTimestamp(c.end)}\n${c.text}\n`).join("\n");
}
