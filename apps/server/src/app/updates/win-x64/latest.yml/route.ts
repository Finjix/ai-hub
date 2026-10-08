import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { getStore } from "@/lib/db";
import { HttpError, jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { db, root } = getStore();
    const release = db.prepare("SELECT id FROM releases WHERE active=1").get() as { id: string } | undefined;
    if (!release) throw new HttpError(404, "目前没有可用的桌面端更新。");
    const file = path.join(root, "updates", "versions", release.id, "latest.yml");
    const info = await stat(file);
    if (!info.isFile() || info.size > 1024 * 1024) throw new HttpError(404, "更新清单不可用。");
    return new Response(await readFile(file), {
      headers: {
        "Content-Type": "text/yaml; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
