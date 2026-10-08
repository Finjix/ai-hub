import { NextResponse } from "next/server";
import { getStore, type VersionRow } from "@/lib/db";
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
    try {
      const version = db.prepare("SELECT * FROM skill_versions WHERE id=? AND skill_id=?").get(versionId, id) as unknown as VersionRow | undefined;
      if (!version) throw new HttpError(404, "找不到这个版本。");
      if (version.status !== "published") throw new HttpError(409, "只有已发布的版本可以撤回。");
      const now = new Date().toISOString();
      db.prepare("UPDATE skill_versions SET status='withdrawn' WHERE id=?").run(versionId);
      db.prepare("UPDATE skills SET updated_at=? WHERE id=?").run(now, id);
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* transaction may not have started */ }
      throw error;
    }
    return NextResponse.json({ ok: true, versionId, status: "withdrawn" });
  } catch (error) {
    return jsonError(error);
  }
}
