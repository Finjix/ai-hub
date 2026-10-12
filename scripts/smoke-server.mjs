import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { ZipFile } from 'yazl';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const portable = process.argv.includes('--portable');
const packaged = portable ? JSON.parse(await readFile(path.join(root, 'artifacts/server/latest-build.json'), 'utf8')) : null;
const entry = packaged ? path.join(packaged.directory, 'app/apps/server/server.js') : path.join(root, 'apps/server/.next/standalone/apps/server/server.js');
const executable = packaged ? path.join(packaged.directory, 'runtime/node.exe') : process.execPath;
const temporary = await mkdtemp(path.join(tmpdir(), 'ai-hub-http-'));
const socket = createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
let child, output = '';
async function start() {
  const env = { ...process.env, HOSTNAME: '127.0.0.1', PORT: String(port), AI_HUB_DATA_DIR: path.join(temporary, 'server-data'), NODE_ENV: 'production' };
  if (portable) env.PATH = '';
  child = spawn(executable, [entry], { cwd: temporary, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.on('data', chunk => { output = (output + chunk).slice(-100000); });
  child.stderr.on('data', chunk => { output = (output + chunk).slice(-100000); });
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) throw new Error(`Server exited ${child.exitCode}: ${output}`);
    try { const result = await fetch(`${base}/api/v1/health`); if (result.ok) return result.json(); } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Server startup timeout: ${output}`);
}
async function stop() { if (child && child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited; } }
async function request(route, init, expected = 200) {
  const response = await fetch(`${base}${route}`, init);
  const body = await response.text(); assert.equal(response.status, expected, `${route}: ${body}`);
  return body ? JSON.parse(body) : null;
}
async function zipFor(version) {
  const zip = new ZipFile(); zip.addBuffer(Buffer.from('---\nname: lifecycle-smoke\ndescription: A skill used by the automated lifecycle verification\n---\n# Lifecycle test'), 'test/SKILL.md'); zip.addBuffer(Buffer.from(`version ${version}`), 'test/version.txt'); zip.end();
  const chunks = []; for await (const chunk of zip.outputStream) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks);
}
async function upload(version, route = '/api/v1/admin/skills') {
  const form = new FormData(); form.set('file', new File([await zipFor(version)], 'skill.zip')); form.set('version', version); form.set('displayName', '生命周期验证');
  return request(route, { method: 'POST', body: form }, 201);
}
try {
  const health = await start(); assert.equal(health.ok, true); assert.equal(health.nodeVersion, 'v24.21.0');
  assert.equal((await request('/api/v1/skills')).skills.length, 0);
  const created = await upload('1.0.0');
  assert.equal((await request('/api/v1/skills')).skills.length, 0);
  await request(`/downloads/skills/${created.skillId}/${created.versionId}.zip`, undefined, 404);
  await request(`/api/v1/admin/skills/${created.skillId}/versions/${created.versionId}/publish`, { method: 'POST' });
  const published = await request('/api/v1/skills'); assert.equal(published.skills.length, 1); assert.equal(published.skills[0].latestVersion.version, '1.0.0');
  const downloaded = await fetch(`${base}${published.skills[0].latestVersion.downloadPath}`); assert.equal(downloaded.status, 200);
  assert.equal(createHash('sha256').update(Buffer.from(await downloaded.arrayBuffer())).digest('hex'), published.skills[0].latestVersion.sha256);
  const invalid = new FormData(); invalid.set('file', new File(['not zip'], 'broken.zip')); invalid.set('version', '2.0.0');
  await request('/api/v1/admin/skills', { method: 'POST', body: invalid }, 400);
  await request(`/api/v1/admin/skills/${created.skillId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Origin: 'http://unexpected.invalid' }, body: JSON.stringify({ displayName: 'blocked' }) }, 403);

  const compiled = path.join(temporary, 'engine.cjs');
  await build({ entryPoints: [path.join(root, 'apps/desktop/electron/engine.ts')], outfile: compiled, bundle: true, platform: 'node', format: 'cjs' });
  const { SkillEngine } = createRequire(import.meta.url)(compiled);
  const engine = new SkillEngine(path.join(temporary, 'client-state'), path.join(temporary, 'home'), '0.1.0'); await engine.init(); await engine.connect(base); await engine.install(created.skillId);
  const installedFile = path.join(engine.installRoot, 'lifecycle-smoke/version.txt'); assert.equal(await readFile(installedFile, 'utf8'), 'version 1.0.0');
  await writeFile(installedFile, 'user changes');
  const next = await upload('1.1.0', `/api/v1/admin/skills/${created.skillId}/versions`);
  await request(`/api/v1/admin/skills/${created.skillId}/versions/${next.versionId}/publish`, { method: 'POST' });
  await engine.refresh(); await engine.waitForIdle(); assert.equal(await readFile(installedFile, 'utf8'), 'version 1.1.0');
  await engine.uninstall('lifecycle-smoke'); await engine.refresh(); await engine.waitForIdle(); assert.equal((await engine.snapshot()).localSkills.length, 0);

  const exeName = 'AI-Hub-Setup-0.2.0.exe', exe = Buffer.from('test installer fixture'), blockmapName = `${exeName}.blockmap`;
  const sha512 = createHash('sha512').update(exe).digest('base64');
  const manifest = `version: 0.2.0\nfiles:\n  - url: ${exeName}\n    sha512: ${sha512}\n    size: ${exe.length}\npath: ${exeName}\nsha512: ${sha512}\nreleaseDate: 2026-10-08T00:00:00.000Z\n`;
  const release = new FormData(); release.append('files', new File([exe], exeName)); release.append('files', new File(['blockmap fixture'], blockmapName)); release.append('files', new File([manifest], 'latest.yml'));
  await request('/api/v1/admin/releases', { method: 'POST', body: release }, 201);
  const current = await fetch(`${base}/updates/win-x64/latest.yml`); assert.equal(current.status, 200); assert.match(current.headers.get('cache-control'), /no-store/); assert.match(await current.text(), /0.2.0/);
  const range = await fetch(`${base}/updates/win-x64/${exeName}`, { headers: { Range: 'bytes=0-3' } }); assert.equal(range.status, 206); assert.equal(await range.text(), 'test');
  const invalidRange = await fetch(`${base}/updates/win-x64/${exeName}`, { headers: { Range: 'bytes=99999-' } }); assert.equal(invalidRange.status, 416); assert.equal((await invalidRange.arrayBuffer()).byteLength, 0);
  const oldServerId = health.serverId; await stop(); const restarted = await start(); assert.equal(restarted.serverId, oldServerId); assert.equal((await request('/api/v1/skills')).skills.length, 1);
  const admin = await fetch(`${base}/admin`); assert.equal(admin.status, 200); assert.match(await admin.text(), /AI Hub/);
  console.log(`PASS: ${portable ? 'portable Node (PATH empty)' : 'standalone'} HTTP publish/download, engine auto-update/uninstall, updater manifest/ranges, restart persistence, /admin`);
} catch (error) { console.error(output); throw error; }
finally { await stop(); const relative = path.relative(tmpdir(), temporary); if (!relative.startsWith('..') && relative.startsWith('ai-hub-http-')) await rm(temporary, { recursive: true, force: true }); }
