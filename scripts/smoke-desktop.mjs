import { _electron as electron } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { ZipFile } from 'yazl';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const temporary = await mkdtemp(path.join(tmpdir(), 'ai-hub-ui-'));
const screenshotRoot = path.join(root, 'artifacts/screenshots'); await mkdir(screenshotRoot, { recursive: true });
const socket = createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve)); const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [path.join(root, 'apps/server/.next/standalone/apps/server/server.js')], { cwd: temporary, env: { ...process.env, HOSTNAME: '127.0.0.1', PORT: String(port), AI_HUB_DATA_DIR: path.join(temporary, 'server-data'), NODE_ENV: 'production' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let serverOutput = ''; server.stdout.on('data', chunk => { serverOutput = (serverOutput + chunk).slice(-100000); }); server.stderr.on('data', chunk => { serverOutput = (serverOutput + chunk).slice(-100000); });
let app, page;
async function startApp() {
  const env = { ...process.env, AI_HUB_TEST_MODE: '1', AI_HUB_HEADLESS: '1', AI_HUB_USER_DATA_DIR: path.join(temporary, 'client-state'), AI_HUB_TEST_HOME: path.join(temporary, 'home') }; delete env.ELECTRON_RUN_AS_NODE; delete env.AI_HUB_DEV_URL;
  app = await electron.launch({ executablePath: require('electron'), args: [path.join(root, 'apps/desktop')], cwd: root, env, timeout: 45000 });
  page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!window.aiHub); return page;
}
async function wait(predicate, label) {
  for (let i = 0; i < 150; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`Timeout: ${label}`);
}
async function screenshot(windowPage, file) {
  await windowPage.evaluate(() => document.fonts.ready);
  await new Promise(resolve => setTimeout(resolve, 200));
  const id = await windowPage.evaluate(() => window.aiHub ? 'main' : 'admin');
  const encoded = await app.evaluate(async ({ BrowserWindow }, kind) => {
    const window = BrowserWindow.getAllWindows().find(window => kind === 'main' ? window.webContents.getURL().startsWith('aihub://') : window.webContents.getURL().startsWith('http://'));
    if (!window) throw new Error('Screenshot window missing');
    return (await window.webContents.capturePage({ stayHidden: true, stayAwake: true })).toPNG().toString('base64');
  }, id);
  await writeFile(file, Buffer.from(encoded, 'base64'));
}
async function zipSkill(name, version) {
  const zip = new ZipFile(); zip.addBuffer(Buffer.from(`---\nname: ${name}\ndescription: 自动化界面验证使用的技能\n---\n# 技能说明\n\n先阅读变更，再根据事实给出建议。`), `${name}/SKILL.md`); zip.addBuffer(Buffer.from(version), `${name}/version.txt`); zip.end(); const chunks = []; for await (const chunk of zip.outputStream) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks);
}
async function seed(name, displayName, version = '1.0.0', skillId) {
  const form = new FormData(); form.set('file', new File([await zipSkill(name, version)], 'skill.zip')); form.set('version', version); form.set('displayName', displayName); form.set('category', '开发工具'); form.set('tags', '["代码","效率"]');
  const response = await fetch(`${base}/api/v1/admin/skills${skillId ? `/${skillId}/versions` : ''}`, { method: 'POST', body: form }); const data = await response.json(); assert.equal(response.status, 201, JSON.stringify(data));
  const publish = await fetch(`${base}/api/v1/admin/skills/${data.skillId}/versions/${data.versionId}/publish`, { method: 'POST' }); assert.equal(publish.status, 200); return data;
}
try {
  await wait(async () => { try { return (await fetch(`${base}/api/v1/health`)).ok; } catch { return false; } }, 'server startup');
  const review = await seed('review-helper', '代码审查助手'); await seed('writing-helper', '技术写作助手');
  await startApp();
  await page.getByRole('button', { name: '连接服务器' }).waitFor();
  await wait(async () => page.getByRole('button', { name: '连接服务器' }).isEnabled(), 'client ready');
  await page.getByRole('textbox', { name: '服务器地址' }).fill(base); await page.getByRole('button', { name: '连接服务器' }).click();
  await page.locator('.skill-card').first().waitFor(); assert.equal(await page.locator('.skill-card').count(), 2);
  await screenshot(page, path.join(screenshotRoot, 'desktop-store.png'));
  const card = page.locator('.skill-card').filter({ hasText: '代码审查助手' });
  await card.getByRole('heading', { name: '代码审查助手' }).click(); await page.getByRole('dialog', { name: '技能详情' }).waitFor(); await screenshot(page, path.join(screenshotRoot, 'desktop-detail.png')); await page.getByRole('button', { name: '关闭详情' }).click();
  await card.getByRole('button', { name: '安装', exact: true }).click();
  await wait(async () => (await page.evaluate(() => window.aiHub.snapshot())).localSkills.some(skill => skill.managed?.name === 'review-helper'), 'skill install');
  const installed = path.join(temporary, 'home/.codex/skills/review-helper/version.txt'); assert.equal(await readFile(installed, 'utf8'), '1.0.0');
  await page.locator('nav').getByRole('button', { name: /已安装/ }).click(); await screenshot(page, path.join(screenshotRoot, 'desktop-installed.png'));
  await writeFile(installed, 'local edits'); await seed('review-helper', '代码审查助手', '1.1.0', review.skillId);
  await page.evaluate(() => window.aiHub.refresh());
  await wait(async () => (await page.evaluate(() => window.aiHub.snapshot())).localSkills.some(skill => skill.managed?.version === '1.1.0'), 'automatic overwrite'); assert.equal(await readFile(installed, 'utf8'), '1.1.0');
  await seed('review-helper', '代码审查助手', '1.2.0', review.skillId); await app.close(); app = null; await startApp();
  await wait(async () => (await page.evaluate(() => window.aiHub.snapshot())).localSkills.some(skill => skill.managed?.version === '1.2.0'), 'startup auto-update');
  await page.locator('nav').getByRole('button', { name: /已安装/ }).click(); await page.getByRole('button', { name: '卸载', exact: true }).click(); await page.getByRole('button', { name: '确认卸载' }).click();
  await wait(async () => !(await page.evaluate(() => window.aiHub.snapshot())).localSkills.some(skill => skill.managed), 'uninstall');
  await page.getByRole('button', { name: /^任务/ }).click(); await screenshot(page, path.join(screenshotRoot, 'desktop-tasks.png'));
  const failures = (await page.evaluate(() => window.aiHub.snapshot())).tasks.filter(task => task.status === 'failed'); assert.deepEqual(failures, []);

  const adminPromise = app.waitForEvent('window');
  await app.evaluate(async ({ BrowserWindow }, url) => { const adminWindow = new BrowserWindow({ width: 1300, height: 880, show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } }); await adminWindow.loadURL(url); }, `${base}/admin`);
  const admin = await adminPromise; await admin.waitForLoadState('domcontentloaded'); await admin.locator('.skill-card').first().waitFor();
  await screenshot(admin, path.join(screenshotRoot, 'admin-skills.png'));
  await admin.getByRole('button', { name: '添加技能', exact: true }).click();
  const add = admin.getByRole('dialog', { name: '添加技能' }); const uiZip = path.join(temporary, 'ui-added.zip'); await writeFile(uiZip, await zipSkill('ui-uploaded', '1.0.0'));
  await add.locator('input[type=file]').setInputFiles(uiZip); await add.locator('input[name=version]').fill('1.0.0'); await add.locator('input[name=displayName]').fill('界面上传验证'); await add.locator('input[name=tags]').fill('代码，验证'); await add.getByRole('button', { name: '添加技能', exact: true }).click();
  await add.waitFor({ state: 'hidden' }); await admin.locator('.skill-card').filter({ hasText: '界面上传验证' }).click();
  await admin.getByRole('dialog', { name: '技能详情' }).waitFor(); await admin.getByRole('button', { name: '发布', exact: true }).click();
  await wait(async () => { const list = await (await fetch(`${base}/api/v1/skills`)).json(); return list.skills.some(skill => skill.name === 'ui-uploaded'); }, 'admin UI publish');
  await screenshot(admin, path.join(screenshotRoot, 'admin-version.png'));
  console.log('PASS: real Electron bridge/rendering, connect/detail/install, direct overwrite, startup update, uninstall/tasks, admin UI ZIP upload/publish');
} catch (error) { if (page) { await screenshot(page, path.join(screenshotRoot, 'failure.png')).catch(() => {}); console.error(await page.evaluate(() => ({ text: document.body.innerText, snapshot: window.aiHub?.snapshot() })).catch(() => null)); } console.error(serverOutput); throw error; }
finally { if (app) await app.close(); if (server.exitCode === null) { const exited = new Promise(resolve => server.once('exit', resolve)); server.kill(); await exited; } const relative = path.relative(tmpdir(), temporary); if (!relative.startsWith('..') && relative.startsWith('ai-hub-ui-')) await rm(temporary, { recursive: true, force: true, maxRetries: 15, retryDelay: 100 }); }
