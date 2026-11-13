/**
 * Deterministic frame composition (SVG → PNG via resvg). All text — captions, price, disclosure —
 * is rendered here, never by an image model, so Thai shaping and product facts stay exact.
 */
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { escapeXml, wrapText } from "./text";

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
const FONT_FILES = ["IBMPlexSansThai-Regular.ttf", "IBMPlexSansThai-SemiBold.ttf", "IBMPlexSansThai-Bold.ttf", "Kanit-Bold.ttf", "Kanit-ExtraBold.ttf"].map((f) =>
  path.join(FONT_DIR, f),
);
const BODY = "IBM Plex Sans Thai";
const HEAD = "Kanit";

export type Palette = { from: string; to: string; accent: string };

export function svgToPng(svg: string, width: number): Buffer {
  const r = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: BODY },
    background: "rgba(0,0,0,0)",
  });
  return r.render().asPng();
}

/** Hash a string to a stable number (deterministic decorative layout). */
function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/**
 * Scene background. Demo/hybrid: self-generated gradient + bokeh (licensed, made here).
 * When `imageDataUri` is supplied (AI-generated lifestyle scene), it is placed full-bleed with a
 * legibility gradient. Rendered larger than the output so Ken Burns zoom stays sharp.
 */
export function backgroundSvg(opts: { width: number; height: number; palette: Palette; seed: string; imageDataUri?: string | null }): string {
  const { width: W, height: H, palette } = opts;
  const rnd = seeded(opts.seed);
  const circles = Array.from({ length: 9 }, () => {
    const r = (0.08 + rnd() * 0.22) * W;
    return `<circle cx="${(rnd() * W).toFixed(1)}" cy="${(rnd() * H).toFixed(1)}" r="${r.toFixed(1)}" fill="${palette.accent}" opacity="${(0.05 + rnd() * 0.12).toFixed(2)}"/>`;
  }).join("");
  const img = opts.imageDataUri
    ? `<image href="${opts.imageDataUri}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>
       <rect width="${W}" height="${H}" fill="url(#shade)"/>`
    : `<rect width="${W}" height="${H}" fill="url(#bg)"/>
       <rect width="${W}" height="${H}" fill="url(#glow)"/>
       ${circles}
       <g opacity="0.07" stroke="#ffffff" stroke-width="${(W / 400).toFixed(2)}">
         ${Array.from({ length: 7 }, (_, i) => `<line x1="${(i * W) / 6}" y1="0" x2="${(i * W) / 6 - W * 0.4}" y2="${H}"/>`).join("")}
       </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${palette.from}"/><stop offset="1" stop-color="${palette.to}"/></linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.3" r="0.6"><stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.25"/><stop offset="0.55" stop-color="#000" stop-opacity="0.05"/><stop offset="1" stop-color="#000" stop-opacity="0.6"/></linearGradient>
  </defs>
  ${img}
</svg>`;
}

/** Licensed placeholder product illustration (generic shopping bag) — NOT actual product imagery. */
function placeholderProduct(x: number, y: number, size: number, accent: string, label: string): string {
  const s = size;
  return `<g>
    <path d="M ${x + s * 0.32} ${y + s * 0.3} Q ${x + s * 0.32} ${y + s * 0.12} ${x + s * 0.5} ${y + s * 0.12} Q ${x + s * 0.68} ${y + s * 0.12} ${x + s * 0.68} ${y + s * 0.3}" fill="none" stroke="#3a3f5c" stroke-width="${s * 0.035}" stroke-linecap="round"/>
    <rect x="${x + s * 0.2}" y="${y + s * 0.28}" width="${s * 0.6}" height="${s * 0.5}" rx="${s * 0.05}" fill="${accent}"/>
    <rect x="${x + s * 0.2}" y="${y + s * 0.28}" width="${s * 0.6}" height="${s * 0.1}" rx="${s * 0.05}" fill="#ffffff" opacity="0.25"/>
    <circle cx="${x + s * 0.5}" cy="${y + s * 0.55}" r="${s * 0.09}" fill="#ffffff" opacity="0.85"/>
    <text x="${x + s / 2}" y="${y + s * 0.9}" font-family="${BODY}" font-size="${(s * 0.045).toFixed(1)}" fill="#5b5f7a" text-anchor="middle">${escapeXml(label)}</text>
  </g>`;
}

export type OverlayInput = {
  width: number;
  height: number;
  palette: Palette;
  language: "th" | "en";
  shotType: "hook" | "problem" | "solution" | "showcase" | "benefit" | "cta";
  caption: string;
  subtitle: string | null;
  disclosure: string | null;
  productTitle: string;
  brand: string | null;
  /** Authorized product image as data URI, or null → placeholder illustration. */
  productImageDataUri: string | null;
  priceText: string | null;
  priceNote: string | null;
  sceneIndex: number;
  sceneCount: number;
};

/** Transparent overlay: story progress bars, disclosure, product card, caption, price, subtitles. */
export function overlaySvg(o: OverlayInput): string {
  const W = o.width;
  const H = o.height;
  const s = W / 720;
  const parts: string[] = [];

  // story-style progress segments
  const gap = 8 * s;
  const segW = (W - 48 * s - gap * (o.sceneCount - 1)) / o.sceneCount;
  for (let i = 0; i < o.sceneCount; i++) {
    parts.push(
      `<rect x="${(24 * s + i * (segW + gap)).toFixed(1)}" y="${(22 * s).toFixed(1)}" width="${segW.toFixed(1)}" height="${(5 * s).toFixed(1)}" rx="${(3 * s).toFixed(1)}" fill="#ffffff" opacity="${i <= o.sceneIndex ? 0.95 : 0.35}"/>`,
    );
  }

  if (o.disclosure) {
    const fs = 21 * s;
    const lines = wrapText(o.disclosure, W - 96 * s, fs, 1);
    const tw = Math.min(W - 48 * s, (lines[0]?.length ?? 0) * fs * 0.58 + 36 * s);
    parts.push(`<rect x="${24 * s}" y="${44 * s}" width="${tw.toFixed(1)}" height="${42 * s}" rx="${21 * s}" fill="#000000" opacity="0.55"/>`);
    parts.push(`<text x="${42 * s}" y="${72 * s}" font-family="${BODY}" font-weight="600" font-size="${fs.toFixed(1)}" fill="#ffffff">${escapeXml(lines[0] ?? "")}</text>`);
  }

  const showCard = o.shotType !== "problem";
  const cardSize = W * 0.6;
  const cardX = (W - cardSize) / 2;
  const cardY = H * 0.13;
  let textTop = H * 0.36;
  if (showCard) {
    parts.push(`<rect x="${cardX + 10 * s}" y="${cardY + 18 * s}" width="${cardSize}" height="${cardSize}" rx="${36 * s}" fill="#000000" opacity="0.25"/>`);
    parts.push(`<rect x="${cardX}" y="${cardY}" width="${cardSize}" height="${cardSize}" rx="${36 * s}" fill="#ffffff" opacity="0.96"/>`);
    if (o.productImageDataUri) {
      const pad = 26 * s;
      parts.push(
        `<clipPath id="pc"><rect x="${cardX + pad}" y="${cardY + pad}" width="${cardSize - pad * 2}" height="${cardSize - pad * 2}" rx="${24 * s}"/></clipPath>`,
        `<image href="${o.productImageDataUri}" x="${cardX + pad}" y="${cardY + pad}" width="${cardSize - pad * 2}" height="${cardSize - pad * 2}" preserveAspectRatio="xMidYMid meet" clip-path="url(#pc)"/>`,
      );
    } else {
      parts.push(placeholderProduct(cardX, cardY, cardSize, o.palette.accent, o.language === "th" ? "ภาพประกอบ — ไม่ใช่ภาพสินค้าจริง" : "Illustration — not the actual product"));
    }
    textTop = cardY + cardSize + 64 * s;
  }

  if (o.shotType === "cta" || o.shotType === "showcase") {
    const t = [o.brand, o.productTitle].filter(Boolean).join(" · ");
    const fs = 24 * s;
    const lines = wrapText(t, W - 96 * s, fs, 2);
    lines.forEach((l, i) => {
      parts.push(`<text x="${W / 2}" y="${(textTop + i * fs * 1.35).toFixed(1)}" font-family="${BODY}" font-weight="600" font-size="${fs.toFixed(1)}" fill="#ffffff" opacity="0.92" text-anchor="middle">${escapeXml(l)}</text>`);
    });
    textTop += lines.length * fs * 1.35 + 18 * s;
  }

  const capFs = (showCard ? 50 : 64) * s;
  const capLines = wrapText(o.caption, W - 90 * s, capFs, showCard ? 3 : 5);
  capLines.forEach((l, i) => {
    parts.push(
      `<text x="${W / 2}" y="${(textTop + capFs + i * capFs * 1.28).toFixed(1)}" font-family="${HEAD}" font-weight="700" font-size="${capFs.toFixed(1)}" fill="#ffffff" stroke="#1a1530" stroke-opacity="0.55" stroke-width="${(6 * s).toFixed(1)}" paint-order="stroke" stroke-linejoin="round" text-anchor="middle">${escapeXml(l)}</text>`,
    );
  });
  let y = textTop + capFs + capLines.length * capFs * 1.28;

  if (o.priceText && (o.shotType === "showcase" || o.shotType === "cta")) {
    const fs = 40 * s;
    const pw = o.priceText.length * fs * 0.62 + 56 * s;
    parts.push(`<rect x="${(W - pw) / 2}" y="${y}" width="${pw}" height="${fs * 1.6}" rx="${fs * 0.8}" fill="#ffe59b"/>`);
    parts.push(`<text x="${W / 2}" y="${y + fs * 1.15}" font-family="${HEAD}" font-weight="800" font-size="${fs}" fill="#282536" text-anchor="middle">${escapeXml(o.priceText)}</text>`);
    y += fs * 1.6 + 30 * s;
    if (o.priceNote) {
      parts.push(`<text x="${W / 2}" y="${y}" font-family="${BODY}" font-size="${18 * s}" fill="#ffffff" opacity="0.85" text-anchor="middle">${escapeXml(o.priceNote)}</text>`);
    }
  }

  if (o.subtitle) {
    const fs = 27 * s;
    const lines = wrapText(o.subtitle, W - 110 * s, fs, 2);
    const boxH = lines.length * fs * 1.4 + 28 * s;
    const boxY = H - 48 * s - boxH;
    parts.push(`<rect x="${32 * s}" y="${boxY}" width="${W - 64 * s}" height="${boxH}" rx="${18 * s}" fill="#000000" opacity="0.6"/>`);
    lines.forEach((l, i) => {
      parts.push(`<text x="${W / 2}" y="${(boxY + 14 * s + fs * 1.05 + i * fs * 1.4).toFixed(1)}" font-family="${BODY}" font-weight="600" font-size="${fs}" fill="#ffffff" text-anchor="middle">${escapeXml(l)}</text>`);
    });
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("\n")}</svg>`;
}

export function dataUri(buf: Buffer, mime: string) {
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/** Detect PNG/JPEG from magic bytes (only formats resvg embeds reliably). */
export function sniffImageMime(buf: Buffer): "image/png" | "image/jpeg" | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  return null;
}
