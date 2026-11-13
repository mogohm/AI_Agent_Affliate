"use client";
import * as React from "react";
import { Player } from "@remotion/player";
import { AffiliateVideo, totalFrames, type AffiliateVideoProps } from "@/remotion/AffiliateVideo";
import { cn } from "@/lib/utils";

const FPS = 30;

/** 9:16 phone frame. Shows the rendered MP4 when available, otherwise a live Remotion storyboard preview. */
export function PhonePreview({ videoUrl, posterUrl, preview, className }: { videoUrl?: string | null; posterUrl?: string | null; preview: AffiliateVideoProps | null; className?: string }) {
  return (
    <div className={cn("relative mx-auto aspect-[9/16] w-full max-w-[300px] overflow-hidden rounded-[26px] border-[6px] border-[#38435b] bg-black shadow-[0_20px_55px_#0004]", className)}>
      {videoUrl ? (
        <video key={videoUrl} src={videoUrl} poster={posterUrl ?? undefined} controls playsInline className="h-full w-full object-cover" data-testid="rendered-video" />
      ) : preview && preview.scenes.length ? (
        <Player
          component={AffiliateVideo}
          inputProps={preview}
          durationInFrames={totalFrames(preview.scenes, FPS)}
          compositionWidth={720}
          compositionHeight={1280}
          fps={FPS}
          controls
          loop
          acknowledgeRemotionLicense
          style={{ width: "100%", height: "100%" }}
        />
      ) : (
        <div className="grid h-full place-items-center bg-hero p-6 text-center">
          <div>
            <div className="text-6xl">{preview?.emoji ?? "🎥"}</div>
            <strong className="mt-3 block text-lg text-white">{preview?.productTitle ?? "ยังไม่มี Storyboard"}</strong>
            <small className="mt-2 block text-[#dfe9ff]">สร้างสคริปต์เพื่อดูตัวอย่าง</small>
          </div>
        </div>
      )}
    </div>
  );
}
