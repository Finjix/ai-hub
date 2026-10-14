import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getStore, type SkillRow, type VersionRow } from "@/lib/db";
import { HttpError, jsonError, requireSameOrigin, requiredText } from "@/lib/http";
import { isValidSkillId, pruneVersionsForUpload } from "@/lib/skills";
import { assertVersion, inspectUpload, persistArchive, removeTemp } from "@/lib/zip-upload";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let upload: Awaited<ReturnType<typeof inspectUpload>> | undefined;
  let archivePath: string | undefined;
  let committed = false;
  let pruned: string[] = [];
  try {
    requireSameOrigin(request);
    const { id } = await context.params;
    if (!isValidSkillId(id)) throw new HttpError(404, "找不到这个技能。");
    const { db } = getStore();
    const skill = db.prepare("SELECT * FROM skills WHERE id = ?").get(id) as unknown as SkillRow | undefined;
    if (!skill) throw new HttpError(404, "找不到这个技能。");
    const form = await request.formData();
    upload = await inspectUpload(form.get("file"));
    if (upload.metadata.name.toLowerCase() !== skill.name.toLowerCase()) {
      throw new HttpError(409, `ZIP 包中的技能名称是「${upload.metadata.name}」，必须与「${skill.name}」一致。`);
    }
    const version = requiredText(form.get("version"), "版本号", 100);
    assertVersion(version);
    const previous = db.prepare("SELECT version FROM skill_versions WHERE skill_id = ?").all(id) as unknown as Array<{ version: string }>;
    if (previous.some((item) => item.version === version)) {
      throw new HttpError(409, `版本 ${version} 已经存在，请填写一个新的版本号。`);
    }

    const versionId = randomUUID();
    const { sha256, size } = upload;
    const markdown = upload.metadata.markdown;
    archivePath = await persistArchive(upload, id, versionId);
    upload = undefined;
    const downloadPath = `/downloads/skills/${id}/${versionId}.zip`;
    try {
      db.exec("BEGIN IMMEDIATE");
      pruned = pruneVersionsForUpload(db, id);
      db.prepare(`INSERT INTO skill_versions (id,skill_id,version,status,sha256,size,download_path,archive_path,markdown,created_at,published_at)
        VALUES (?,?,?,'draft',?,?,?,?,?,?,NULL)`).run(versionId, id, version, sha256, size, downloadPath, archivePath, markdown, new Date().toISOString());
      db.prepare("UPDATE skills SET updated_at=? WHERE id=?").run(new Date().toISOString(), id);
      db.exec("COMMIT");
      committed = true;
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* transaction may not have started */ }
      pruned = [];
      throw error;
    }
    return NextResponse.json({ ok: true, skillId: id, versionId, version }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  } finally {
    if (upload) await removeTemp(upload);
    if (archivePath && !committed) await rm(archivePath, { force: true }).catch(() => undefined);
    for (const file of pruned) await rm(file, { force: true }).catch(() => undefined);
  }
}
