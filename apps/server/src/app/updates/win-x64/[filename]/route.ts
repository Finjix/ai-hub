import path from "node:path";
import { getStore, type ReleaseRow } from "@/lib/db";
import { streamFile } from "@/lib/file-response";
import { HttpError, jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ filename: string }> }) {
  try {
    const { filename } = await context.params;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/.test(filename) || filename.includes("..") || filename === "latest.yml") {
      throw new HttpError(404, "找不到这个更新文件。");
    }
    const { db, root } = getStore();
    const releases = db.prepare("SELECT * FROM releases ORDER BY created_at DESC").all() as unknown as ReleaseRow[];
    const release = releases.find((row) => (JSON.parse(row.files_json) as string[]).includes(filename));
    if (!release || release.directory !== release.id) throw new HttpError(404, "找不到这个更新文件。");
    const file = path.join(root, "updates", "versions", release.id, filename);
    return await streamFile(file, request, filename);
  } catch (error) {
    return jsonError(error);
  }
}
