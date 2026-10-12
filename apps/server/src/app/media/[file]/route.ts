import path from "node:path";
import { getStore } from "@/lib/db";
import { streamFile } from "@/lib/file-response";
import { describeMedia, isMediaFileName } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ file: string }> }) {
  const { file } = await context.params;
  const type = isMediaFileName(file) ? describeMedia(file) : null;
  if (!type) return new Response("Not found", { status: 404 });
  try {
    const { root } = getStore();
    // Media names are random UUIDs, so a stored file never changes.
    return await streamFile(path.join(root, "media", file), request, undefined, { "Content-Type": type.contentType, "Cache-Control": "public, max-age=31536000, immutable" });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
