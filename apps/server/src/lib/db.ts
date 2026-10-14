import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type SkillStatus = "active" | "archived";
export type VersionStatus = "draft" | "published";

export interface SkillRow {
  id: string;
  name: string;
  display_name: string;
  description: string;
  category: string;
  tags_json: string;
  introduction: string;
  status: SkillStatus;
  created_at: string;
  updated_at: string;
}

export interface VersionRow {
  id: string;
  skill_id: string;
  version: string;
  status: VersionStatus;
  sha256: string;
  size: number;
  download_path: string;
  archive_path: string;
  markdown: string;
  created_at: string;
  published_at: string | null;
}

export interface ReleaseRow {
  id: string;
  version: string;
  directory: string;
  manifest: string;
  files_json: string;
  created_at: string;
  active: number;
}

export interface Store {
  db: DatabaseSync;
  root: string;
  serverId: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __aiHubStore: Store | undefined;
}

export function getStore(): Store {
  if (globalThis.__aiHubStore) return globalThis.__aiHubStore;

  const root = path.resolve(/*turbopackIgnore: true*/ process.env.AI_HUB_DATA_DIR || path.join(process.cwd(), "data"));
  mkdirSync(root, { recursive: true });
  mkdirSync(path.join(root, "tmp"), { recursive: true });
  mkdirSync(path.join(root, "skills"), { recursive: true });
  mkdirSync(path.join(root, "media"), { recursive: true });
  mkdirSync(path.join(root, "updates", "versions"), { recursive: true });

  const db = new DatabaseSync(path.join(root, "ai-hub.sqlite"));
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      display_name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL CHECK (status IN ('active','archived')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS skill_versions (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      version TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft','published','withdrawn')),
      sha256 TEXT NOT NULL,
      size INTEGER NOT NULL,
      download_path TEXT NOT NULL,
      archive_path TEXT NOT NULL,
      markdown TEXT NOT NULL,
      created_at TEXT NOT NULL,
      published_at TEXT,
      UNIQUE(skill_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_skill_versions_order ON skill_versions(skill_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS releases (
      id TEXT PRIMARY KEY,
      version TEXT NOT NULL UNIQUE,
      directory TEXT NOT NULL,
      manifest TEXT NOT NULL,
      files_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1))
    );
  `);
  const skillColumns = db.prepare("PRAGMA table_info(skills)").all() as unknown as { name: string }[];
  if (!skillColumns.some((column) => column.name === "introduction")) {
    db.exec("ALTER TABLE skills ADD COLUMN introduction TEXT NOT NULL DEFAULT ''");
  }
  const versionColumns = db.prepare("PRAGMA table_info(skill_versions)").all() as unknown as { name: string }[];
  if (versionColumns.some((column) => column.name === "changelog")) {
    db.exec("ALTER TABLE skill_versions DROP COLUMN changelog");
  }
  // Versions are no longer withdrawn, and only one version per skill is live: keep the latest published one.
  db.exec(`UPDATE skill_versions SET status='draft' WHERE status='withdrawn';
    UPDATE skill_versions SET status='draft' WHERE status='published' AND id <> (
      SELECT v.id FROM skill_versions v WHERE v.skill_id = skill_versions.skill_id AND v.status='published'
      ORDER BY v.published_at DESC, v.created_at DESC LIMIT 1)`);

  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('server_id', ?)").run(randomUUID());
  const serverId = (db.prepare("SELECT value FROM settings WHERE key = 'server_id'").get() as { value: string }).value;

  const store = { db, root, serverId };
  globalThis.__aiHubStore = store;
  return store;
}
