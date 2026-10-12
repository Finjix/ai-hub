import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, lstat, open, rename, rm } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { AppUpdateState, DesktopSnapshot, HealthResponse, InstalledSkill, LocalSkill, Skill, SkillDetail, SkillListResponse, TaskStatus } from '@ai-hub/shared';
import { isNewerVersion, isValidVersion, normalizeServerUrl, validateSkillName } from '@ai-hub/shared';
import { extractSkillZip, sha256File } from '@ai-hub/shared/archive';

interface DiskState { serverUrl: string; serverId: string; skills: Skill[]; installed: InstalledSkill[]; tasks: TaskStatus[]; autoUpdateSkills?: boolean; launchAtLogin?: boolean }
interface Journal { txId: string; name: string; hadTarget: boolean; previous: InstalledSkill | null; phase: 'prepared' | 'committed' }
const DEFAULT_SERVER_URL = 'http://10.9.168.24:3000';
// Network-level failures (refused, DNS, timeout) surface as an opaque "fetch failed"; show a readable message instead.
const request = (url: string | URL, init: RequestInit) => fetch(url, init).catch(() => { throw new Error('无法连接服务器'); });
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
async function exists(file: string) { try { await lstat(file); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; } }

export async function atomicJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx');
  try { await handle.writeFile(JSON.stringify(value, null, 2), 'utf8'); await handle.sync(); }
  finally { await handle.close(); }
  try { await rename(temporary, file); } finally { await rm(temporary, { force: true }); }
}

export async function safeRemove(candidate: string, within: string) {
  const relative = path.relative(path.resolve(within), path.resolve(candidate));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('拒绝删除目标目录之外的路径');
  await rm(candidate, { recursive: true, force: true });
}

export class SkillEngine {
  private state: DiskState = { serverUrl: '', serverId: '', skills: [], installed: [], tasks: [] };
  private queue: Promise<void> = Promise.resolve();
  private pending = new Map<string, Promise<void>>();
  private change: () => void = () => {};
  private connectionMessage = '请连接团队技能服务器';
  private connected = false;
  private lastProgress = 0;
  private closing = false;
  appUpdate: AppUpdateState = { status: 'idle', progress: 0, message: '启动后自动检查应用版本' };
  readonly installRoot: string;
  readonly workRoot: string;
  readonly stateFile: string;
  readonly journalFile: string;

  constructor(readonly userData: string, home: string, readonly appVersion: string) {
    this.installRoot = path.join(home, '.codex', 'skills');
    this.workRoot = path.join(home, '.codex', '.ai-hub-work');
    this.stateFile = path.join(userData, 'state.json');
    this.journalFile = path.join(userData, 'operation.json');
  }

  onChange(callback: () => void) { this.change = callback; }
  notify() { this.change(); }
  get serverUrl() { return this.state.serverUrl; }
  get busy() { return this.pending.size > 0; }

  async init() {
    await mkdir(this.userData, { recursive: true });
    await mkdir(this.installRoot, { recursive: true });
    await mkdir(this.workRoot, { recursive: true });
    await this.assertRoots();
    try {
      const data = JSON.parse(await readFile(this.stateFile, 'utf8')) as DiskState;
      if (!Array.isArray(data.installed) || !Array.isArray(data.tasks) || !Array.isArray(data.skills)) throw new Error('安装记录格式损坏');
      if (data.serverUrl) normalizeServerUrl(data.serverUrl);
      for (const entry of data.installed) { validateSkillName(entry.name); if (!isValidVersion(entry.version)) throw new Error('安装版本记录损坏'); }
      this.state = data;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (!this.state.serverUrl) this.state.serverUrl = DEFAULT_SERVER_URL;
    await this.recover();
    this.state.tasks = this.state.tasks.slice(0, 100).map(task => ['queued', 'running'].includes(task.status) ? { ...task, status: 'failed', message: '上次操作被中断，请重新尝试' } : task);
    const installed: InstalledSkill[] = [];
    for (const entry of this.state.installed) if (await exists(this.target(entry.name))) installed.push(entry);
    this.state.installed = installed;
    await this.save();
  }

  private async assertRoots() {
    for (const root of [this.installRoot, this.workRoot]) {
      const info = await lstat(root);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('技能或临时目录不能是符号链接或连接点');
    }
  }
  private target(name: string) { validateSkillName(name); return path.join(this.installRoot, name); }
  private work(txId: string) { if (!/^[0-9a-f-]{36}$/.test(txId)) throw new Error('操作记录格式损坏'); return path.join(this.workRoot, txId); }
  private async save() { await atomicJson(this.stateFile, this.state); }

  async recover() {
    if (!await exists(this.journalFile)) return;
    const journal = JSON.parse(await readFile(this.journalFile, 'utf8')) as Journal;
    validateSkillName(journal.name);
    const target = this.target(journal.name), work = this.work(journal.txId), backup = path.join(work, 'old');
    await this.assertRoots();
    if (journal.phase !== 'committed') {
      if (await exists(backup)) {
        if (await exists(target)) await safeRemove(target, this.installRoot);
        await rename(backup, target);
      } else if (!journal.hadTarget && await exists(target)) await safeRemove(target, this.installRoot);
      this.state.installed = this.state.installed.filter(entry => entry.name !== journal.name);
      if (journal.previous) { validateSkillName(journal.previous.name); if (journal.previous.name !== journal.name) throw new Error('恢复记录名称不匹配'); this.state.installed.push(journal.previous); }
      await this.save();
    }
    await safeRemove(work, this.workRoot);
    await rm(this.journalFile, { force: true });
  }

  private enqueue(key: string, kind: TaskStatus['kind'], label: string, operation: (task: TaskStatus) => Promise<void>, skillId?: string): Promise<void> {
    if (this.closing) return Promise.reject(new Error('应用正在准备更新，请稍后再试'));
    if (this.pending.has(key)) return this.pending.get(key)!;
    const task: TaskStatus = { id: randomUUID(), label, kind, status: 'queued', progress: 0, message: '等待执行', createdAt: new Date().toISOString(), skillId };
    this.state.tasks.unshift(task);
    this.state.tasks = this.state.tasks.slice(0, 100);
    const run = this.queue.then(async () => {
      task.status = 'running'; task.message = '正在处理'; this.notify();
      try { await operation(task); task.status = 'success'; task.progress = 100; task.message = kind === 'sync' ? '技能目录已同步' : '操作完成'; }
      catch (error) { task.status = 'failed'; task.message = message(error); throw error; }
      finally { this.pending.delete(key); await this.save(); this.notify(); }
    });
    this.pending.set(key, run);
    this.queue = run.catch(() => {});
    this.notify();
    return run;
  }

  async snapshot(): Promise<DesktopSnapshot> {
    const localSkills: LocalSkill[] = [];
    for (const entry of await readdir(this.installRoot, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || !entry.isDirectory() || entry.isSymbolicLink()) continue;
      const directory = path.join(this.installRoot, entry.name);
      const managed = this.state.installed.find(record => record.name === entry.name) ?? null;
      let description = managed ? '由 AI Hub 管理，启动时自动更新' : '外部安装的技能';
      try {
        const manifestPath = path.join(directory, 'SKILL.md');
        const info = await lstat(manifestPath);
        if (info.isSymbolicLink() || info.size > 1024 * 1024) continue;
        const markdown = await readFile(manifestPath, 'utf8');
        description = /^description:\s*["']?([^\r\n]+)/m.exec(markdown)?.[1]?.replace(/["']$/, '') ?? description;
        localSkills.push({ name: entry.name, description, path: directory, managed });
      } catch { if (managed) localSkills.push({ name: entry.name, description: '技能文件缺失，请重新安装', path: directory, managed }); }
    }
    return structuredClone({ serverUrl: this.state.serverUrl, connected: this.connected, connectionMessage: this.connectionMessage, appVersion: this.appVersion, installRoot: this.installRoot, skills: this.state.skills, localSkills, tasks: this.state.tasks, appUpdate: this.appUpdate, busy: this.busy, autoUpdateSkills: this.state.autoUpdateSkills !== false, launchAtLogin: this.launchAtLogin });
  }

  private async json<T>(serverUrl: string, route: string): Promise<T> {
    const response = await request(`${serverUrl}${route}`, { signal: AbortSignal.timeout(25000), redirect: 'error' });
    const reader = response.body?.getReader();
    if (!reader) throw new Error('服务器响应为空');
    let length = 0; const chunks: Uint8Array[] = [];
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 10 * 1024 * 1024) throw new Error('服务器响应过大'); chunks.push(value); }
    } finally { await reader.cancel().catch(() => {}); }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as T & { error?: string };
    if (!response.ok) throw new Error(data.error ?? `服务器错误 (${response.status})`);
    return data;
  }

  async connect(input: string) {
    if (this.busy) throw new Error('请等待当前技能操作完成后切换服务器');
    const serverUrl = normalizeServerUrl(input);
    // Keep the new address even if it is unreachable, so the user's setting survives and later refreshes retry it.
    if (serverUrl !== this.state.serverUrl) { this.state.serverUrl = serverUrl; this.state.serverId = ''; this.state.skills = []; }
    this.connected = false; this.connectionMessage = '未连接服务器';
    await this.save(); this.notify();
    let health: HealthResponse;
    try {
      health = await this.json<HealthResponse>(serverUrl, '/api/v1/health');
      if (health.ok !== true || typeof health.serverId !== 'string') throw new Error('地址不是有效的 AI Hub 服务器');
    } catch (error) { this.connectionMessage = '连接失败，请检查服务器 IP'; this.notify(); throw error; }
    this.state.serverId = health.serverId;
    this.connected = true; this.connectionMessage = '服务器已连接';
    await this.save(); await this.refresh();
    return this.snapshot();
  }

  // Defaults to on; the OS login item itself is applied by the main process.
  get launchAtLogin() { return this.state.launchAtLogin !== false; }

  async setLaunchAtLogin(enabled: boolean) {
    this.state.launchAtLogin = enabled;
    await this.save(); this.notify();
    return this.snapshot();
  }

  async setAutoUpdateSkills(enabled: boolean) {
    this.state.autoUpdateSkills = enabled;
    await this.save(); this.notify();
    return this.snapshot();
  }

  refresh(): Promise<void> {
    if (!this.state.serverUrl) return Promise.resolve();
    return this.enqueue('sync', 'sync', '同步团队技能库', async () => {
      try {
        const result = await this.json<SkillListResponse>(this.state.serverUrl, '/api/v1/skills');
        if (typeof result.serverId !== 'string' || !Array.isArray(result.skills)) throw new Error('目录响应格式不正确');
        for (const skill of result.skills) { validateSkillName(skill.name); if (typeof skill.id !== 'string') throw new Error('技能信息格式不正确'); }
        this.state.skills = result.skills; this.state.serverId = result.serverId;
        this.connected = true; this.connectionMessage = '服务器已连接';
        if (this.state.autoUpdateSkills !== false) for (const installed of this.state.installed) {
          if (installed.serverId !== result.serverId) continue;
          const skill = result.skills.find(item => item.id === installed.skillId && item.name === installed.name);
          if (skill?.latestVersion && isNewerVersion(skill.latestVersion.version, installed.version)) this.install(skill.id).catch(() => {});
        }
      } catch (error) { this.connected = false; this.connectionMessage = '连接失败，正在显示上次同步的目录'; throw error; }
    });
  }

  async detail(id: string): Promise<SkillDetail> {
    if (!this.state.serverUrl || !this.state.skills.some(skill => skill.id === id)) throw new Error('技能不存在或服务器未连接');
    const result = await this.json<{ serverId: string; skill: SkillDetail }>(this.state.serverUrl, `/api/v1/skills/${encodeURIComponent(id)}`);
    if (result.serverId !== this.state.serverId || result.skill?.id !== id) throw new Error('服务器资源来源发生变化，请重新同步');
    return result.skill;
  }

  install(id: string): Promise<void> {
    const listed = this.state.skills.find(skill => skill.id === id);
    if (!listed) return Promise.reject(new Error('技能不存在'));
    const updating = this.state.installed.some(entry => entry.name === listed.name);
    return this.enqueue(`skill:${listed.name}`, updating ? 'update' : 'install', `${updating ? '更新' : '安装'} ${listed.displayName}`, async task => {
      await this.recover(); await this.assertRoots();
      const skill = await this.detail(id);
      validateSkillName(skill.name);
      if (skill.name !== listed.name) throw new Error('技能名称不一致');
      const version = skill.latestVersion;
      if (!version || !isValidVersion(version.version) || !/^[a-f0-9]{64}$/.test(version.sha256) || !Number.isSafeInteger(version.size) || version.size < 1) throw new Error('技能版本或完整性信息不正确');
      const previous = this.state.installed.find(entry => entry.name === skill.name) ?? null;
      if (previous && (previous.serverId !== this.state.serverId || previous.skillId !== skill.id)) throw new Error('此名称已由其他来源的技能占用');
      if (previous && isNewerVersion(previous.version, version.version)) throw new Error('不会将已安装的技能降级');
      const target = this.target(skill.name), hadTarget = await exists(target);
      if (hadTarget) {
        const info = await lstat(target);
        if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('安装目标不是普通目录');
        if (!previous) throw new Error('同名技能已从外部安装，请先自行移除该目录');
      }
      const txId = randomUUID(), work = this.work(txId), staging = path.join(work, 'new');
      await mkdir(work);
      let journalWritten = false;
      try {
        const archive = path.join(work, 'package.zip');
        const url = new URL(version.downloadPath, this.state.serverUrl);
        if (url.origin !== this.state.serverUrl || !url.pathname.startsWith('/downloads/skills/') || url.username || url.password || url.hash || url.search) throw new Error('资源下载地址不属于当前服务器');
        task.message = '正在下载'; this.notify();
        const response = await request(url, { redirect: 'error', signal: AbortSignal.timeout(120000) });
        if (!response.ok || !response.body) throw new Error(`下载失败 (${response.status})`);
        let downloaded = 0;
        const counter = new Transform({ transform: (chunk: Buffer, _encoding, callback) => {
          downloaded += chunk.length;
          if (downloaded > version.size) { callback(new Error('下载文件超过声明大小')); return; }
          task.progress = Math.round(downloaded / version.size * 75);
          if (Date.now() - this.lastProgress > 100) { this.lastProgress = Date.now(); this.notify(); }
          callback(null, chunk);
        }});
        await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), counter, createWriteStream(archive, { flags: 'wx' }));
        if (downloaded !== version.size || await sha256File(archive) !== version.sha256) throw new Error('下载文件完整性校验失败');
        task.message = '正在校验并解压'; task.progress = 80; this.notify();
        const inspected = await extractSkillZip(archive, staging);
        if (inspected.name !== skill.name) throw new Error('ZIP 内的 Skill 名称与发布信息不一致');
        if (await exists(target)) {
          if (!hadTarget || (await lstat(target)).isSymbolicLink()) throw new Error('安装目录在下载期间发生变化，请重新尝试');
        }
        const journal: Journal = { txId, name: skill.name, hadTarget, previous, phase: 'prepared' };
        await atomicJson(this.journalFile, journal); journalWritten = true;
        if (hadTarget) await rename(target, path.join(work, 'old'));
        await rename(staging, target);
        const installed: InstalledSkill = { skillId: id, serverId: this.state.serverId, serverUrl: this.state.serverUrl, name: skill.name, displayName: skill.displayName, version: version.version, sha256: version.sha256, installedAt: new Date().toISOString(), path: target };
        this.state.installed = [...this.state.installed.filter(entry => entry.name !== skill.name), installed];
        await this.save();
        await atomicJson(this.journalFile, { ...journal, phase: 'committed' });
        await this.recover();
      } catch (error) {
        if (journalWritten) await this.recover();
        else await safeRemove(work, this.workRoot);
        throw error;
      }
    }, id);
  }

  uninstall(name: string): Promise<void> {
    validateSkillName(name);
    const installed = this.state.installed.find(entry => entry.name === name);
    if (!installed) return Promise.reject(new Error('只能卸载 AI Hub 管理的技能'));
    return this.enqueue(`skill:${name}`, 'uninstall', `卸载 ${installed.displayName}`, async () => {
      await this.recover(); await this.assertRoots();
      const currentInstalled = this.state.installed.find(entry => entry.name === name);
      if (!currentInstalled) throw new Error('该技能已卸载');
      const target = this.target(name), hadTarget = await exists(target);
      if (hadTarget && (await lstat(target)).isSymbolicLink()) throw new Error('卸载目标不能是连接点');
      const txId = randomUUID(), work = this.work(txId);
      await mkdir(work);
      const journal: Journal = { txId, name, hadTarget, previous: currentInstalled, phase: 'prepared' };
      await atomicJson(this.journalFile, journal);
      try {
        if (hadTarget) await rename(target, path.join(work, 'old'));
        this.state.installed = this.state.installed.filter(entry => entry.name !== name);
        await this.save();
        await atomicJson(this.journalFile, { ...journal, phase: 'committed' });
        await this.recover();
      } catch (error) { await this.recover(); throw error; }
    }, installed.skillId);
  }

  async waitForIdle() { let current; do { current = this.queue; await current; } while (current !== this.queue); }
  async prepareToQuit() { this.closing = true; await this.waitForIdle(); }
}
