/* eslint-disable @next/next/no-img-element -- external marketplace images of arbitrary hosts */
import { cn } from "@/lib/utils";

const GRADS = [
  "bg-[linear-gradient(140deg,#4c5c91,#253d58)]",
  "bg-[linear-gradient(130deg,#68436d,#43334d)]",
  "bg-[linear-gradient(130deg,#45867d,#234b55)]",
  "bg-[linear-gradient(130deg,#97764e,#4e4140)]",
  "bg-[linear-gradient(130deg,#57689f,#363967)]",
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Product thumbnail: listing image if available, otherwise a neutral gradient tile (never a fake product photo). */
export function ProductThumb({ title, imageUrl, emoji, size = 48, className }: { title: string; imageUrl?: string | null; emoji?: string | null; size?: number; className?: string }) {
  const style = { width: size, height: size };
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        referrerPolicy="no-referrer"
        loading="lazy"
        style={style}
        className={cn("shrink-0 rounded-xl border border-line object-cover", className)}
      />
    );
  }
  return (
    <div style={{ ...style, fontSize: size * 0.48 }} className={cn("grid shrink-0 place-items-center rounded-xl text-white", GRADS[hash(title) % GRADS.length], className)} aria-hidden>
      {emoji ?? title.trim().charAt(0)}
    </div>
  );
}
