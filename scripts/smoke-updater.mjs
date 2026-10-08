import { _electron as electron } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url), asar = require('@electron/asar');
const temporary = await mkdtemp(path.join(tmpdir(), 'ai-hub-updater-'));
const installDirectory = path.join(temporary, 'installed'), executable = path.join(installDirectory, 'AI Hub.exe');
const installer = path.join(root, 'artifacts/desktop/AI-Hub-Setup-0.1.0.exe');
const v2 = path.join(root, 'artifacts/updater-test/v2');
const env = { ...process.env, LOCALAPPDATA: path.join(temporary, 'local'), AI_HUB_TEST_MODE: '1', AI_HUB_HEADLESS: '1', AI_HUB_USER_DATA_DIR: path.join(temporary, 'client-state'), AI_HUB_TEST_HOME: path.join(temporary, 'home') }; delete env.ELECTRON_RUN_AS_NODE; delete env.AI_HUB_DEV_URL;
function powershell(script) { return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from("$ProgressPreference = 'SilentlyContinue'; " + script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true }).trim(); }
const existing = powershell("[bool](Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'AI Hub' })");
const defaultProfile = path.join(process.env.APPDATA, '@ai-hub', 'desktop');
let profileExists = false; try { await access(defaultProfile); profileExists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (existing === 'True' || profileExists) {
  const relative = path.relative(tmpdir(), temporary);
  if (!relative.startsWith('..') && relative.startsWith('ai-hub-updater-')) await rm(temporary, { recursive: true, force: true });
  throw new Error('当前用户已有 AI Hub 安装或用户数据；为避免修改现有状态，真实 NSIS 升级测试应在独立 Windows 用户下运行');
}
async function run(exe, args) {
  const child = spawn(exe, args, { env, windowsHide: true, stdio: 'ignore' });
  const timeout = setTimeout(() => child.kill(), 120000);
  try { const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); if (code !== 0) throw new Error(`${path.basename(exe)} exited with ${code}`); } finally { clearTimeout(timeout); }
}
function killInstalledProcess() {
  const relative = path.relative(temporary, executable); if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('测试进程路径不在隔离目录内');
  const literal = executable.replace(/'/g, "''");
  powershell(`Get-CimInstance Win32_Process -Filter "Name = 'AI Hub.exe'" | Where-Object { $_.ExecutablePath -eq '${literal}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`);
}
async function wait(predicate, label, count = 600) { for (let i = 0; i < count; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(`Timeout: ${label}`); }
function installedVersion() { try { return JSON.parse(asar.extractFile(path.join(installDirectory, 'resources/app.asar'), 'package.json').toString()).version; } catch { return null; } }
const socket = createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve)); const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [path.join(root, 'apps/server/.next/standalone/apps/server/server.js')], { cwd: temporary, env: { ...process.env, HOSTNAME: '127.0.0.1', PORT: String(port), AI_HUB_DATA_DIR: path.join(temporary, 'server-data'), NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let serverOutput = '', app, installed = false;
server.stdout.on('data', chunk => { serverOutput = (serverOutput + chunk).slice(-100000); }); server.stderr.on('data', chunk => { serverOutput = (serverOutput + chunk).slice(-100000); });
try {
  await access(installer); await access(path.join(v2, 'latest.yml'));
  await wait(async () => { try { return (await fetch(`${base}/api/v1/health`)).ok; } catch { return false; } }, 'server startup');
  const files = ['AI-Hub-Setup-0.1.1.exe', 'AI-Hub-Setup-0.1.1.exe.blockmap', 'latest.yml'];
  const release = new FormData(); for (const file of files) release.append('files', new File([await readFile(path.join(v2, file))], file));
  const result = await fetch(`${base}/api/v1/admin/releases`, { method: 'POST', body: release }); const resultBody = await result.text(); assert.equal(result.status, 201, resultBody);
  const skillForm = new FormData(); skillForm.set('file', new File([await readFile(path.join(root, 'artifacts/examples/review-helper-1.0.0.zip'))], 'skill.zip')); skillForm.set('version', '1.0.0');
  const skillResponse = await fetch(`${base}/api/v1/admin/skills`, { method: 'POST', body: skillForm }); const skill = await skillResponse.json(); assert.equal(skillResponse.status, 201);
  assert.equal((await fetch(`${base}/api/v1/admin/skills/${skill.skillId}/versions/${skill.versionId}/publish`, { method: 'POST' })).status, 200);
  console.log('Installing isolated NSIS 0.1.0...'); await run(installer, ['/S', `/D=${installDirectory}`]); installed = true;
  killInstalledProcess(); assert.equal(installedVersion(), '0.1.0');
  app = await electron.launch({ executablePath: executable, env, timeout: 45000 }); const page = await app.firstWindow(); await page.waitForFunction(() => !!window.aiHub);
  await page.evaluate(url => window.aiHub.connect(url), base); await page.evaluate(id => window.aiHub.install(id), skill.skillId);
  await wait(async () => (await page.evaluate(() => window.aiHub.snapshot())).appUpdate.status === 'ready', 'downloaded genuine 0.1.1 update');
  const ready = await page.evaluate(() => window.aiHub.snapshot()); assert.equal(ready.appUpdate.version, '0.1.1'); assert.equal(ready.localSkills[0].managed.version, '1.0.0');
  console.log('Genuine update downloaded and verified; confirming restart...');
  const closed = app.waitForEvent('close');
  await page.evaluate(() => window.aiHub.restartForUpdate()).catch(error => { if (!/closed|Target|destroyed/.test(error.message)) throw error; }); await closed; app = null;
  await wait(async () => installedVersion() === '0.1.1', 'NSIS replacement');
  await wait(async () => powershell(`[bool](Get-CimInstance Win32_Process -Filter "Name = 'AI Hub.exe'" | Where-Object { $_.ExecutablePath -eq '${executable.replace(/'/g, "''")}' -and $_.CommandLine -notlike '*--type=*' })`) === 'True', 'updated app automatically relaunched');
  // NSIS launches via the user shell, so reattach with an explicit test environment.
  killInstalledProcess();
  app = await electron.launch({ executablePath: executable, env, timeout: 45000 }); const updatedPage = await app.firstWindow(); await updatedPage.waitForFunction(() => !!window.aiHub);
  await wait(async () => { try { return /Update for version 0\.1\.1 is not available/.test(await readFile(path.join(temporary, 'client-state/logs/main.log'), 'utf8')); } catch { return false; } }, 'updated app relaunched and checked server');
  const preserved = JSON.parse(await readFile(path.join(temporary, 'client-state/state.json'), 'utf8')); assert.equal(preserved.serverUrl, base); assert.equal(preserved.installed[0].name, 'review-helper');
  const updated = await updatedPage.evaluate(() => window.aiHub.snapshot()); assert.equal(updated.appVersion, '0.1.1'); assert.equal(updated.serverUrl, base); assert.equal(updated.localSkills[0].managed.name, 'review-helper');
  await readFile(path.join(temporary, 'home/.codex/skills/review-helper/SKILL.md'));
  await mkdir(path.join(root, 'artifacts/verification'), { recursive: true });
  await writeFile(path.join(root, 'artifacts/verification/updater.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), from: '0.1.0', to: '0.1.1', target: 'NSIS per-user', downloaded: true, confirmedRestart: true, installed: true, relaunched: true, serverSettingsPreserved: true, skillRegistryPreserved: true }, null, 2));
  console.log('PASS: installed NSIS 0.1.0 -> 0.1.1, HTTP download/SHA512, confirm restart, auto relaunch, settings and skill records preserved');
} catch (error) { console.error(serverOutput); try { console.error((await readFile(path.join(temporary, 'client-state/logs/main.log'), 'utf8')).slice(-12000)); } catch {} throw error; }
finally {
  if (app) await app.close().catch(() => {}); killInstalledProcess();
  if (installed) { const uninstaller = path.join(installDirectory, 'Uninstall AI Hub.exe'); await run(uninstaller, ['/S']).catch(error => console.error(`Uninstall cleanup: ${error.message}`)); }
  if (server.exitCode === null) { const exited = new Promise(resolve => server.once('exit', resolve)); server.kill(); await exited; }
  const relative = path.relative(tmpdir(), temporary); if (!relative.startsWith('..') && relative.startsWith('ai-hub-updater-')) await rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
