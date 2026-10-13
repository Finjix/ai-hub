import semver from 'semver';

export interface SkillVersion {
  id: string; skillId: string; version: string; status: 'draft' | 'published' | 'withdrawn';
  sha256: string; size: number; downloadPath: string; markdown: string; changelog: string;
  createdAt: string; publishedAt: string | null;
}
export interface Skill {
  id: string; name: string; displayName: string; description: string;
  status: 'active' | 'archived'; latestVersion: SkillVersion | null;
  createdAt: string; updatedAt: string;
}
export interface SkillDetail extends Skill { introduction: string; versions: SkillVersion[] }
export interface SkillListResponse { serverId: string; skills: Skill[] }
export interface HealthResponse { ok: true; serverId: string; nodeVersion: string }
export interface InstalledSkill {
  skillId: string; serverId: string; serverUrl: string; name: string; displayName: string;
  version: string; sha256: string; installedAt: string; path: string;
}
export interface LocalSkill { name: string; description: string; path: string; managed: InstalledSkill | null }
export interface TaskStatus {
  id: string; label: string; kind: 'install' | 'update' | 'uninstall' | 'sync';
  status: 'queued' | 'running' | 'success' | 'failed'; progress: number; message: string;
  createdAt: string; skillId?: string;
}
export interface AppUpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'disabled';
  version?: string; progress: number; message: string;
}
export interface DesktopSnapshot {
  serverUrl: string; connected: boolean; connectionMessage: string; appVersion: string;
  installRoot: string; skills: Skill[]; localSkills: LocalSkill[]; tasks: TaskStatus[];
  appUpdate: AppUpdateState; busy: boolean; autoUpdateSkills: boolean; launchAtLogin: boolean;
}
export interface DesktopBridge {
  snapshot(): Promise<DesktopSnapshot>;
  connect(url: string): Promise<DesktopSnapshot>;
  refresh(): Promise<void>;
  setAutoUpdateSkills(enabled: boolean): Promise<DesktopSnapshot>;
  setLaunchAtLogin(enabled: boolean): Promise<DesktopSnapshot>;
  detail(id: string): Promise<SkillDetail>;
  install(id: string): Promise<void>;
  uninstall(name: string): Promise<void>;
  checkAppUpdate(): Promise<void>;
  restartForUpdate(): Promise<void>;
  openAdmin(): Promise<void>;
  openFolder(): Promise<void>;
  onChange(callback: (state: DesktopSnapshot) => void): () => void;
}
export function isValidVersion(value: unknown): value is string {
  return typeof value === 'string' && semver.valid(value) === value && value.length <= 64;
}
export function isNewerVersion(candidate: string, current: string): boolean {
  return isValidVersion(candidate) && isValidVersion(current) && semver.gt(candidate, current);
}
export function validateSkillName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) {
    throw new Error('Skill 名称必须是 1–64 位小写字母、数字或连字符，且不能使用 Windows 保留名称');
  }
}
// App versions are plain semver and display without a "v" prefix, e.g. 1.2.3.
export function formatAppVersion(version: string): string {
  return version.replace(/^v/i, '');
}
export function normalizeServerUrl(input: string): string {
  const url = new URL(input.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('请输入服务器根地址，例如 http://192.168.1.10:3000');
  }
  return url.origin;
}
