import type { Skill, SkillDetail, SkillListResponse, SkillVersion } from "@ai-hub/shared";
import type { DatabaseSync } from "node:sqlite";
import { getStore, type SkillRow, type VersionRow } from "./db";

export const MAX_VERSIONS = 3;

// Makes room for one more version by deleting the oldest unpublished ones. Runs inside the
// caller's transaction; returns the archives to remove once it commits.
export function pruneVersionsForUpload(db: DatabaseSync, skillId: string): string[] {
  const rows = db.prepare("SELECT * FROM skill_versions WHERE skill_id = ? ORDER BY created_at ASC").all(skillId) as unknown as VersionRow[];
  const removable = rows.filter((row) => row.status !== "published").slice(0, Math.max(0, rows.length - (MAX_VERSIONS - 1)));
  for (const row of removable) db.prepare("DELETE FROM skill_versions WHERE id = ?").run(row.id);
  return removable.map((row) => row.archive_path);
}

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
    createdAt: row.created_at,
    publishedAt: row.published_at,
  };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };
const SUMMARY_MAX = 200;

// The skill plaza shows the opening text of the rich-text introduction as each skill's summary.
export function introductionSummary(html: string): string {
  const text = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    // Block boundaries become spaces; inline tags vanish so <strong> etc. don't split CJK words.
    .replace(/<\/?(p|div|li|ul|ol|h[1-6]|br|hr|blockquote|pre|table|tr|td|th|img|video)\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name: string) => ENTITIES[name])
    .replace(/\s+/g, " ")
    .trim();
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX)}…` : text;
}

function skillBase(row: SkillRow, latestVersion: SkillVersion | null): Skill {
  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    description: introductionSummary(row.introduction),
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

// One version per skill is live; it is whichever the admin published last, not necessarily the highest.
export function latestPublished(versions: SkillVersion[]): SkillVersion | null {
  return versions.find((version) => version.status === "published") ?? null;
}

export function listSkills({ q = "", admin = false }: { q?: string; admin?: boolean } = {}): SkillListResponse {
  const { db, serverId } = getStore();
  const conditions: string[] = [];
  const args: string[] = [];
  if (!admin) conditions.push("status = 'active'");
  if (q.trim()) {
    conditions.push("(name LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' OR introduction LIKE ? ESCAPE '\\')");
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
