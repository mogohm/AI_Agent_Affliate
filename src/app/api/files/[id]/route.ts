import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { mediaAssets } from "@/db/schema";
import { notFound, route } from "@/lib/api";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Authenticated media delivery with HTTP Range support (video seeking). S3 → short-lived signed URL. */
export const GET = route<{ id: string }>({ permission: "video:read" }, async ({ req, db, session, params }) => {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) throw notFound("File");
  const [a] = await db.select().from(mediaAssets).where(and(eq(mediaAssets.id, params.id), eq(mediaAssets.workspaceId, session.workspaceId)));
  if (!a) throw notFound("File");
  const download = req.nextUrl.searchParams.get("download") === "1";
  const fileName = a.fileName ?? `${a.kind}`;
  const storage = getStorage();
  if (storage.driver === "s3") {
    const url = await storage.signedUrl(a.storageKey, 600, download ? fileName : undefined);
    if (url) return NextResponse.redirect(url, 302);
  }
  const disposition = `${download ? "attachment" : "inline"}; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
  const size = await storage.size(a.storageKey);
  const range = req.headers.get("range");
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  const headers: Record<string, string> = {
    "Content-Type": a.mime,
    "Accept-Ranges": "bytes",
    "Content-Disposition": disposition,
    "Cache-Control": "private, max-age=300",
  };
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    end = Math.min(end, size - 1);
    start = Math.min(start, end);
    if (start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const { body } = await storage.stream(a.storageKey, { start, end });
    return new Response(body, { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
  }
  const { body } = await storage.stream(a.storageKey);
  return new Response(body, { status: 200, headers: { ...headers, "Content-Length": String(size) } });
});
