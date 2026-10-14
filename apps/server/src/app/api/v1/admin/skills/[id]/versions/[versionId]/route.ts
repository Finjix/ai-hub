import { rm } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getStore, type VersionRow } from "@/lib/db";
import { HttpError, jsonError, requireSameOrigin } from "@/lib/http";
import { isValidSkillId } from "@/lib/skills";

export const runtime = "nodejs";

export async function DELETE(request: Request, context: { params: Promise<{ id: string; versionId: string }> }) {
  try {
    requireSameOrigin(request);
    const { id, versionId } = await context.params;
    if (!isValidSkillId(id) || !isValidSkillId(versionId)) throw new HttpError(404, "找不到这个版本。");
    const { db } = getStore();
    const version = db.prepare("SELECT * FROM skill_versions WHERE id=? AND skill_id=?").get(versionId, id) as unknown as VersionRow | undefined;
    if (!version) throw new HttpError(404, "找不到这个版本。");
    // The live version stays so the skill always has something to install; publish another one first.
    if (version.status === "published") throw new HttpError(409, "线上版本不能删除，请先发布其他版本。");
    db.prepare("DELETE FROM skill_versions WHERE id=?").run(versionId);
    db.prepare("UPDATE skills SET updated_at=? WHERE id=?").run(new Date().toISOString(), id);
    await rm(version.archive_path, { force: true }).catch(() => undefined);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
