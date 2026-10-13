import { NextResponse } from "next/server";
import { isNewerVersion } from "@ai-hub/shared";
import { getStore, type SkillRow, type VersionRow } from "@/lib/db";
import { HttpError, jsonError, requireSameOrigin } from "@/lib/http";
import { isValidSkillId } from "@/lib/skills";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string; versionId: string }> }) {
  try {
    requireSameOrigin(request);
    const { id, versionId } = await context.params;
    if (!isValidSkillId(id) || !isValidSkillId(versionId)) throw new HttpError(404, "找不到这个版本。");
    const { db } = getStore();
    db.exec("BEGIN IMMEDIATE");
    let now: string;
    try {
      const skill = db.prepare("SELECT * FROM skills WHERE id=?").get(id) as unknown as SkillRow | undefined;
      const version = db.prepare("SELECT * FROM skill_versions WHERE id=? AND skill_id=?").get(versionId, id) as unknown as VersionRow | undefined;
      if (!skill || !version) throw new HttpError(404, "找不到这个版本。");
      if (skill.status === "archived") throw new HttpError(409, "请先将技能重新上架，再发布新版本。");
      if (version.status !== "draft") throw new HttpError(409, "只有草稿版本可以发布。");
      const existing = db.prepare("SELECT version FROM skill_versions WHERE skill_id=? AND status='published'").all(id) as unknown as Array<{ version: string }>;
      const latest = existing.reduce<string | null>((value, item) => !value || isNewerVersion(item.version, value) ? item.version : value, null);
      if (latest && !isNewerVersion(version.version, latest)) throw new HttpError(409, `版本 ${version.version} 必须高于当前已发布版本 ${latest}。`);
      now = new Date().toISOString();
      db.prepare("UPDATE skill_versions SET status='published',published_at=? WHERE id=?").run(now, versionId);
      db.prepare("UPDATE skills SET updated_at=? WHERE id=?").run(now, id);
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* transaction may not have started */ }
      throw error;
    }
    return NextResponse.json({ ok: true, versionId, status: "published", publishedAt: now });
  } catch (error) {
    return jsonError(error);
  }
}
