import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ZipFile } from 'yazl';
import type { Skill, SkillVersion } from '@ai-hub/shared';
import { atomicJson, safeRemove, SkillEngine } from './engine';

let root: string, server: Server, engine: SkillEngine, url: string, payload: Buffer, skill: Skill;
const serverId = '20000000-0000-4000-8000-000000000001';
async function archive(version: string) {
  const zip = new ZipFile(); zip.addBuffer(Buffer.from('---\nname: review-helper\ndescription: Code review helper\n---\n# Review'), 'release/SKILL.md'); zip.addBuffer(Buffer.from(`server ${version}`), 'release/rules.txt'); zip.end();
  const chunks: Buffer[] = []; for await (const chunk of zip.outputStream) chunks.push(Buffer.from(chunk)); payload = Buffer.concat(chunks);
  const now = new Date().toISOString();
  const latestVersion: SkillVersion = { id: randomUUID(), skillId: 'skill-1', version, status: 'published', sha256: createHash('sha256').update(payload).digest('hex'), size: payload.length, downloadPath: '/downloads/skills/skill-1/current.zip', markdown: '# Review', createdAt: now, publishedAt: now };
  skill = { id: 'skill-1', name: 'review-helper', displayName: 'Review Helper', description: 'Review code', status: 'active', latestVersion, createdAt: now, updatedAt: now };
}
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ai-hub-engine-')); await archive('1.0.0');
  server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/v1/health') response.end(JSON.stringify({ ok: true, serverId, nodeVersion: process.version }));
    else if (request.url === '/api/v1/skills') response.end(JSON.stringify({ serverId, skills: [skill] }));
    else if (request.url === '/api/v1/skills/skill-1') response.end(JSON.stringify({ serverId, skill: { ...skill, versions: [skill.latestVersion] } }));
    else if (request.url?.startsWith('/downloads/skills/')) { response.setHeader('Content-Type', 'application/zip'); response.end(payload); }
    else { response.statusCode = 404; response.end('{}'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  engine = new SkillEngine(path.join(root, 'state'), path.join(root, 'home'), '0.1.0'); await engine.init(); await engine.connect(url);
});
afterEach(async () => { await engine.waitForIdle(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); });
describe('managed skill lifecycle', () => {
  it('installs, automatically overwrites edits, and stays uninstalled on refresh', async () => {
    await engine.install(skill.id); const rules = path.join(engine.installRoot, skill.name, 'rules.txt');
    expect(await readFile(rules, 'utf8')).toBe('server 1.0.0');
    await writeFile(rules, 'local edits'); await archive('1.1.0');
    await engine.refresh(); await engine.waitForIdle();
    expect(await readFile(rules, 'utf8')).toBe('server 1.1.0');
    expect((await engine.snapshot()).localSkills[0].managed?.version).toBe('1.1.0');
    await engine.uninstall(skill.name); await engine.refresh(); await engine.waitForIdle();
    expect((await engine.snapshot()).localSkills).toHaveLength(0);
  });
  it('preserves an installed version when downloaded content fails checksum', async () => {
    await engine.install(skill.id); await archive('2.0.0'); skill.latestVersion!.sha256 = '0'.repeat(64);
    await engine.refresh(); await engine.waitForIdle();
    expect(await readFile(path.join(engine.installRoot, skill.name, 'rules.txt'), 'utf8')).toBe('server 1.0.0');
    const snapshot = await engine.snapshot(); expect(snapshot.localSkills[0].managed?.version).toBe('1.0.0'); expect(snapshot.tasks.some(task => task.status === 'failed' && task.message.includes('完整性'))).toBe(true);
  });
  it('does not overwrite external skill directories', async () => {
    const directory = path.join(engine.installRoot, skill.name); await mkdir(directory); await writeFile(path.join(directory, 'SKILL.md'), 'external');
    await expect(engine.install(skill.id)).rejects.toThrow('外部'); expect(await readFile(path.join(directory, 'SKILL.md'), 'utf8')).toBe('external');
  });
  it('recovers an interrupted replacement and rolls the registry back', async () => {
    await engine.install(skill.id);
    const previous = (await engine.snapshot()).localSkills[0].managed!;
    const txId = randomUUID(), work = path.join(engine.workRoot, txId); await mkdir(work);
    const target = path.join(engine.installRoot, skill.name); await rename(target, path.join(work, 'old')); await mkdir(target); await writeFile(path.join(target, 'rules.txt'), 'partially replaced');
    await atomicJson(engine.journalFile, { txId, name: skill.name, hadTarget: true, previous, phase: 'prepared' });
    const restarted = new SkillEngine(path.join(root, 'state'), path.join(root, 'home'), '0.1.0'); await restarted.init();
    expect(await readFile(path.join(target, 'rules.txt'), 'utf8')).toBe('server 1.0.0'); expect((await restarted.snapshot()).localSkills[0].managed?.version).toBe('1.0.0');
  });
  it('keeps committed new files when a cleanup is interrupted', async () => {
    await engine.install(skill.id); const previous = (await engine.snapshot()).localSkills[0].managed!;
    const txId = randomUUID(), work = path.join(engine.workRoot, txId); await mkdir(path.join(work, 'old'), { recursive: true });
    await atomicJson(engine.journalFile, { txId, name: skill.name, hadTarget: true, previous, phase: 'committed' });
    await engine.recover(); expect(await readFile(path.join(engine.installRoot, skill.name, 'rules.txt'), 'utf8')).toBe('server 1.0.0');
  });
  it('refuses deletions outside an explicitly named root', async () => {
    await expect(safeRemove(root, root)).rejects.toThrow('拒绝'); await expect(safeRemove(path.dirname(root), root)).rejects.toThrow('拒绝');
  });
});
