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
    let now: string;
    try {
      const version = db.prepare("SELECT * FROM skill_versions WHERE id=? AND skill_id=?").get(versionId, id) as unknown as VersionRow | undefined;
      if (!version) throw new HttpError(404, "找不到这个版本。");
      if (version.status === "published") {
        db.exec("COMMIT");
        return NextResponse.json({ ok: true, versionId, status: "published", publishedAt: version.published_at });
      }
      now = new Date().toISOString();
      // Any kept version can go live, including an older one (rollback); it replaces the current one.
      db.prepare("UPDATE skill_versions SET status='draft' WHERE skill_id=? AND status='published'").run(id);
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
