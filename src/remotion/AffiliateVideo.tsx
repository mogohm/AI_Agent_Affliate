"use client";
/**
 * Remotion composition used for the live storyboard preview in the Studio (@remotion/player).
 * Mirrors the server-side hybrid renderer layout (Ken Burns background, product card, Thai
 * caption, price pill, subtitles, disclosure). The final MP4 is produced by the FFmpeg worker.
 */
import React from "react";
import { AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export type PreviewScene = {
  durationSec: number;
  caption: string;
  voiceover: string;
  shotType: "hook" | "problem" | "solution" | "showcase" | "benefit" | "cta";
};

export type AffiliateVideoProps = {
  scenes: PreviewScene[];
  palette: { from: string; to: string; accent: string };
  productTitle: string;
  brand: string | null;
  priceText: string | null;
  disclosure: string | null;
  subtitles: boolean;
  emoji: string | null;
  placeholderLabel: string;
};

export function totalFrames(scenes: PreviewScene[], fps: number) {
  return Math.max(1, Math.round(scenes.reduce((a, s) => a + s.durationSec, 0) * fps));
}

const FONT = "var(--font-thai), 'IBM Plex Sans Thai', system-ui, sans-serif";

function SceneView({ scene, index, count, props }: { scene: PreviewScene; index: number; count: number; props: AffiliateVideoProps }) {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const dur = Math.max(1, Math.round(scene.durationSec * fps));
  const s = width / 720;
  const zoom = index % 2 === 0 ? interpolate(frame, [0, dur], [1, 1.12]) : interpolate(frame, [0, dur], [1.12, 1]);
  const fade = interpolate(frame, [0, 6, dur - 6, dur], [0, 1, 1, 0.85], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const pop = spring({ frame, fps, config: { damping: 14 } });
  const showCard = scene.shotType !== "problem";
  const showPrice = props.priceText && (scene.shotType === "showcase" || scene.shotType === "cta");
  return (
    <AbsoluteFill style={{ opacity: fade, fontFamily: FONT, color: "#fff" }}>
      <AbsoluteFill style={{ transform: `scale(${zoom})`, background: `linear-gradient(135deg, ${props.palette.from}, ${props.palette.to})` }}>
        <AbsoluteFill style={{ background: "radial-gradient(circle at 50% 30%, #ffffff38, transparent 60%)" }} />
        {[0.2, 0.75, 0.4].map((x, i) => (
          <div key={i} style={{ position: "absolute", left: `${x * 100}%`, top: `${(0.15 + i * 0.3) * 100}%`, width: 220 * s, height: 220 * s, borderRadius: "50%", background: props.palette.accent, opacity: 0.12 }} />
        ))}
      </AbsoluteFill>
      <div style={{ position: "absolute", top: 22 * s, left: 24 * s, right: 24 * s, display: "flex", gap: 8 * s }}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} style={{ flex: 1, height: 5 * s, borderRadius: 3 * s, background: "#fff", opacity: i <= index ? 0.95 : 0.35 }} />
        ))}
      </div>
      {props.disclosure && (
        <div style={{ position: "absolute", top: 44 * s, left: 24 * s, background: "#0000008c", borderRadius: 21 * s, padding: `${8 * s}px ${18 * s}px`, fontSize: 21 * s, fontWeight: 600 }}>{props.disclosure}</div>
      )}
      <div style={{ position: "absolute", top: "13%", left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center", padding: `0 ${45 * s}px`, textAlign: "center" }}>
        {showCard && (
          <div style={{ width: width * 0.6, height: width * 0.6, borderRadius: 36 * s, background: "#fffffff5", boxShadow: "10px 18px 0 #00000040", display: "grid", placeItems: "center", transform: `scale(${0.9 + pop * 0.1})`, color: "#5b5f7a" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 150 * s, lineHeight: 1 }}>{props.emoji ?? "🛍️"}</div>
              <div style={{ fontSize: 18 * s, marginTop: 14 * s }}>{props.placeholderLabel}</div>
            </div>
          </div>
        )}
        {(scene.shotType === "showcase" || scene.shotType === "cta") && (
          <div style={{ marginTop: 40 * s, fontSize: 24 * s, fontWeight: 600, opacity: 0.92 }}>{[props.brand, props.productTitle].filter(Boolean).join(" · ")}</div>
        )}
        <div
          style={{
            marginTop: showCard ? 24 * s : "40%",
            fontSize: (showCard ? 50 : 64) * s,
            fontWeight: 800,
            lineHeight: 1.25,
            textShadow: "0 3px 10px #1a1530aa",
            transform: `translateY(${(1 - pop) * 30 * s}px)`,
          }}
        >
          {scene.caption}
        </div>
        {showPrice && (
          <div style={{ marginTop: 24 * s, background: "#ffe59b", color: "#282536", borderRadius: 40 * s, padding: `${8 * s}px ${28 * s}px`, fontSize: 40 * s, fontWeight: 900 }}>{props.priceText}</div>
        )}
      </div>
      {props.subtitles && scene.voiceover && (
        <div style={{ position: "absolute", left: 32 * s, right: 32 * s, bottom: 48 * s, background: "#00000099", borderRadius: 18 * s, padding: `${14 * s}px ${20 * s}px`, fontSize: 27 * s, fontWeight: 600, textAlign: "center", lineHeight: 1.4 }}>
          {scene.voiceover}
        </div>
      )}
    </AbsoluteFill>
  );
}

export const AffiliateVideo: React.FC<AffiliateVideoProps> = (props) => {
  const { fps } = useVideoConfig();
  const durations = props.scenes.map((sc) => Math.max(1, Math.round(sc.durationSec * fps)));
  const starts = durations.map((_, i) => durations.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {props.scenes.map((scene, i) => {
        return (
          <Sequence key={i} from={starts[i]} durationInFrames={durations[i]}>
            <SceneView scene={scene} index={i} count={props.scenes.length} props={props} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
