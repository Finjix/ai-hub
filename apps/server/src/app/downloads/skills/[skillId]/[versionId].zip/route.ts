import path from "node:path";
import { getStore, type SkillRow, type VersionRow } from "@/lib/db";
import { streamFile } from "@/lib/file-response";
import { HttpError, jsonError } from "@/lib/http";
import { isValidSkillId } from "@/lib/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ skillId: string; versionId: string }> }) {
  try {
    const { skillId, versionId } = await context.params;
    if (!isValidSkillId(skillId) || !isValidSkillId(versionId)) throw new HttpError(404, "找不到这个下载文件。");
    const { db, root } = getStore();
    const row = db.prepare(`SELECT v.* FROM skill_versions v JOIN skills s ON s.id=v.skill_id
      WHERE v.id=? AND v.skill_id=? AND v.status='published' AND s.status='active'`).get(versionId, skillId) as unknown as VersionRow | undefined;
    if (!row || row.download_path !== `/downloads/skills/${skillId}/${versionId}.zip`) throw new HttpError(404, "找不到这个下载文件。");
    return await streamFile(path.join(root, "skills", skillId, `${versionId}.zip`), request, `${skillId}-${row.version}.zip`);
  } catch (error) {
    return jsonError(error);
  }
}
