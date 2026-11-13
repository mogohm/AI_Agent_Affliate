import { describe, expect, it } from "vitest";
import { estimateTextWidth, wrapText, escapeXml } from "@/lib/media/text";
import { buildSrt, cuesFromScenes, srtTimestamp } from "@/lib/media/srt";
import { buildFfmpegArgs } from "@/lib/video/render";
import { sniffImageMime } from "@/lib/media/frames";

describe("Thai text layout", () => {
  it("does not count combining marks as width", () => {
    expect(estimateTextWidth("กิ่", 10)).toBeCloseTo(estimateTextWidth("ก", 10));
  });
  it("wraps Thai on word boundaries without splitting clusters", () => {
    const lines = wrapText("ไฟวงแหวนปรับได้สามโทนสีถ่ายคลิปหน้าสว่างขึ้นแน่นอน", 300, 40, 4);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(estimateTextWidth(l, 40)).toBeLessThanOrEqual(300 + 1);
    expect(lines.join("")).toBe("ไฟวงแหวนปรับได้สามโทนสีถ่ายคลิปหน้าสว่างขึ้นแน่นอน");
    for (const l of lines) expect(/^[ัิ-ฺ็-๎]/.test(l)).toBe(false); // no line starts with a mark
  });
  it("truncates with ellipsis beyond max lines", () => {
    const lines = wrapText("คำ ".repeat(80), 200, 30, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
  });
  it("escapes XML", () => {
    expect(escapeXml(`<a & "b">`)).toBe("&lt;a &amp; &quot;b&quot;&gt;");
  });
});

describe("SRT", () => {
  it("formats timestamps", () => {
    expect(srtTimestamp(3725.5)).toBe("01:02:05,500");
  });
  it("builds sequential cues from scene durations", () => {
    const srt = buildSrt(cuesFromScenes([{ durationSec: 3, text: "สวัสดี" }, { durationSec: 4.5, text: "" }, { durationSec: 2, text: "ลิงก์" }]));
    expect(srt).toContain("1\n00:00:00,000 --> 00:00:03,000\nสวัสดี");
    expect(srt).toContain("2\n00:00:07,500 --> 00:00:09,500\nลิงก์");
  });
});

describe("ffmpeg graph", () => {
  it("chains xfade offsets so total duration equals the sum of scenes", () => {
    const args = buildFfmpegArgs({
      scenes: [
        { durationSec: 3, bgPng: "a.png", overlayPng: "o1.png" },
        { durationSec: 5, bgPng: "b.png", overlayPng: "o2.png", voiceMp3: "v.mp3" },
        { durationSec: 4, clipMp4: "c.mp4", overlayPng: "o3.png" },
      ],
      width: 720,
      height: 1280,
      fps: 30,
      music: "calm",
      out: "out.mp4",
    });
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("offset=3.000");
    expect(graph).toContain("offset=8.000");
    expect(graph).toContain("adelay=3000|3000");
    expect(graph).toContain("amix=inputs=2");
    expect(args).toContain("-stream_loop");
    expect(args[args.indexOf("-t", args.indexOf("-filter_complex")) + 1]).toBe("12.000");
    expect(args).toContain("+faststart");
  });
  it("uses silence when music is off", () => {
    const args = buildFfmpegArgs({ scenes: [{ durationSec: 5, bgPng: "a.png", overlayPng: "o.png" }], width: 360, height: 640, fps: 15, music: "none", out: "x.mp4" });
    expect(args[args.indexOf("-filter_complex") + 1]).toContain("anullsrc");
  });
});

describe("image sniffing", () => {
  it("accepts only png/jpeg", () => {
    expect(sniffImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0]))).toBe("image/png");
    expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageMime(Buffer.from("GIF89a"))).toBeNull();
  });
});
