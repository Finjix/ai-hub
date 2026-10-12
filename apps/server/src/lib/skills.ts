import { isNewerVersion } from "@ai-hub/shared";
import type { Skill, SkillDetail, SkillListResponse, SkillVersion } from "@ai-hub/shared";
import { getStore, type SkillRow, type VersionRow } from "./db";

function toVersion(row: VersionRow): SkillVersion {
  return {
    id: row.id,
    skillId: row.skill_id,
    version: row.version,
    status: row.status,
    sha256: row.sha256,
    size: row.size,
    downloadPath: row.download_path,
    markdown: row.markdown,
    changelog: row.changelog,
    createdAt: row.created_at,
    publishedAt: row.published_at,
  };
}

function skillBase(row: SkillRow, latestVersion: SkillVersion | null): Skill {
  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    description: row.description,
    status: row.status,
    latestVersion,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function versionsFor(id: string, publicOnly: boolean): SkillVersion[] {
  const { db } = getStore();
  const query = publicOnly
    ? "SELECT * FROM skill_versions WHERE skill_id = ? AND status = 'published' ORDER BY created_at DESC"
    : "SELECT * FROM skill_versions WHERE skill_id = ? ORDER BY created_at DESC";
  return (db.prepare(query).all(id) as unknown as VersionRow[]).map(toVersion);
}

export function latestPublished(versions: SkillVersion[]): SkillVersion | null {
  return versions.filter((version) => version.status === "published").reduce<SkillVersion | null>((latest, version) => {
    return !latest || isNewerVersion(version.version, latest.version) ? version : latest;
  }, null);
}

export function listSkills({ q = "", admin = false }: { q?: string; admin?: boolean } = {}): SkillListResponse {
  const { db, serverId } = getStore();
  const conditions: string[] = [];
  const args: string[] = [];
  if (!admin) conditions.push("status = 'active'");
  if (q.trim()) {
    conditions.push("(name LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')");
    const like = `%${q.trim().replace(/[\\%_]/g, "\\$&")}%`;
    args.push(like, like, like);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db.prepare(`SELECT * FROM skills ${where} ORDER BY updated_at DESC, display_name COLLATE NOCASE`).all(...args) as unknown as SkillRow[];
  const skills = rows.map((row) => {
    const published = latestPublished(versionsFor(row.id, true));
    return skillBase(row, published);
  }).filter((skill) => admin || skill.latestVersion !== null);
  return { serverId, skills };
}

export function getSkill(id: string, admin = false): { serverId: string; skill: SkillDetail } | null {
  const { db, serverId } = getStore();
  const row = db.prepare("SELECT * FROM skills WHERE id = ?").get(id) as unknown as SkillRow | undefined;
  if (!row || (!admin && row.status !== "active")) return null;
  const versions = versionsFor(id, !admin);
  const published = latestPublished(versions);
  if (!admin && !published) return null;
  return { serverId, skill: { ...skillBase(row, published), introduction: row.introduction, versions } };
}

export function isValidSkillId(value: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(value);
}
