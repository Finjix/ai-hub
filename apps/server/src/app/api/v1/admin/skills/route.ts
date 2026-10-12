import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { NextResponse } from "next/server";
import { isNewerVersion } from "@ai-hub/shared";
import { getStore, type SkillRow, type VersionRow } from "@/lib/db";
import { HttpError, jsonError, requireSameOrigin, requiredText } from "@/lib/http";
import { listSkills } from "@/lib/skills";
import { assertVersion, inspectUpload, persistArchive, removeTemp } from "@/lib/zip-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(listSkills({ admin: true }));
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  let upload: Awaited<ReturnType<typeof inspectUpload>> | undefined;
  let archivePath: string | undefined;
  let committed = false;
  try {
    requireSameOrigin(request);
    const form = await request.formData();
    upload = await inspectUpload(form.get("file"));
    const version = requiredText(form.get("version"), "版本号", 100);
    assertVersion(version);
    const displayName = requiredText(form.get("displayName"), "展示名称", 120);
    const changelog = "";

    const { db } = getStore();
    let skill = db.prepare("SELECT * FROM skills WHERE name = ? COLLATE NOCASE").get(upload.metadata.name) as unknown as SkillRow | undefined;
    const currentVersionRows = skill
      ? db.prepare("SELECT * FROM skill_versions WHERE skill_id = ?").all(skill.id) as unknown as VersionRow[]
      : [];
    if (currentVersionRows.some((row) => row.version === version || (!isNewerVersion(row.version, version) && !isNewerVersion(version, row.version)))) {
      throw new HttpError(409, `技能「${upload.metadata.name}」已经存在版本 ${version}。`);
    }

    const latestPublished = currentVersionRows
      .filter((row) => row.status === "published")
      .reduce<string | null>((value, row) => !value || isNewerVersion(row.version, value) ? row.version : value, null);
    // New uploads go live immediately unless that would break the published-version ordering.
    const publish = (!skill || skill.status !== "archived") && (!latestPublished || isNewerVersion(version, latestPublished));
    const newSkill = !skill;
    if (!skill) {
      skill = {
        id: randomUUID(),
        name: upload.metadata.name,
        display_name: displayName,
        description: upload.metadata.description,
        // Category/tags are no longer used; the legacy NOT NULL columns get neutral values.
        category: "",
        tags_json: "[]",
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }
    const versionId = randomUUID();
    const { sha256, size } = upload;
    const markdown = upload.metadata.markdown;
    archivePath = await persistArchive(upload, skill.id, versionId);
    upload = undefined;
    const downloadPath = `/downloads/skills/${skill.id}/${versionId}.zip`;
    const now = new Date().toISOString();
    try {
      db.exec("BEGIN IMMEDIATE");
      if (newSkill) {
        db.prepare(`INSERT INTO skills (id,name,display_name,description,category,tags_json,status,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?)`).run(skill.id, skill.name, skill.display_name, skill.description, skill.category, skill.tags_json, skill.status, skill.created_at, skill.updated_at);
      }
      db.prepare(`INSERT INTO skill_versions
        (id,skill_id,version,status,sha256,size,download_path,archive_path,markdown,changelog,created_at,published_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        versionId, skill.id, version, publish ? "published" : "draft", sha256, size, downloadPath, archivePath, markdown, changelog, now, publish ? now : null,
      );
      db.exec("COMMIT");
      committed = true;
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* transaction may not have started */ }
      throw error;
    }
    return NextResponse.json({ ok: true, skillId: skill.id, versionId, version, status: publish ? "published" : "draft" }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  } finally {
    if (upload) await removeTemp(upload);
    if (archivePath && !committed) await rm(archivePath, { force: true }).catch(() => undefined);
  }
}
