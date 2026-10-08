import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron';
import path from 'node:path';
import { lstat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import { SkillEngine } from './engine';
import type { AppUpdateState } from '@ai-hub/shared';

protocol.registerSchemesAsPrivileged([{ scheme: 'aihub', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
if (process.env.AI_HUB_TEST_MODE === '1' && process.env.AI_HUB_USER_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.AI_HUB_USER_DATA_DIR));
  app.setPath('cache', path.join(path.resolve(process.env.AI_HUB_USER_DATA_DIR), 'cache'));
}
let window: BrowserWindow | null = null;
let engine: SkillEngine;
let updateCheck = false;
let quitRequested = false;
let broadcasting = 0;
const devUrl = !app.isPackaged ? process.env.AI_HUB_DEV_URL : undefined;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

async function broadcast() {
  const sequence = ++broadcasting;
  const snapshot = await engine.snapshot();
  if (sequence === broadcasting && window && !window.isDestroyed()) window.webContents.send('hub:changed', snapshot);
}
function setUpdate(state: AppUpdateState) { engine.appUpdate = state; engine.notify(); }
async function checkUpdate() {
  if (!app.isPackaged) { setUpdate({ status: 'disabled', progress: 0, message: '开发模式不安装应用更新，请使用安装版验证' }); return; }
  if (!engine.serverUrl) return;
  if (updateCheck || ['downloading', 'ready'].includes(engine.appUpdate.status)) return;
  updateCheck = true;
  try {
    autoUpdater.setFeedURL({ provider: 'generic', url: `${engine.serverUrl}/updates/win-x64/` });
    await autoUpdater.checkForUpdates();
  } catch (error) { setUpdate({ status: 'error', progress: 0, message: errorMessage(error) }); log.warn('应用更新检查失败', error); }
  finally { updateCheck = false; }
}

function setupUpdater() {
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.on('checking-for-update', () => setUpdate({ status: 'checking', progress: 0, message: '正在检查应用版本' }));
  autoUpdater.on('update-not-available', () => setUpdate({ status: 'idle', progress: 0, message: '当前应用已是最新版本' }));
  autoUpdater.on('update-available', info => setUpdate({ status: 'available', version: info.version, progress: 0, message: '发现新版，正在准备下载' }));
  autoUpdater.on('download-progress', info => setUpdate({ status: 'downloading', version: engine.appUpdate.version, progress: Math.round(info.percent), message: '正在后台下载新版应用' }));
  autoUpdater.on('update-downloaded', info => setUpdate({ status: 'ready', version: info.version, progress: 100, message: '新版已下载，点击重启更新' }));
  autoUpdater.on('error', error => setUpdate({ status: 'error', progress: 0, message: /404/.test(error.message) ? '服务器尚未发布应用更新' : error.message }));
}

function registerIpc() {
  const handle = (channel: string, action: (...args: unknown[]) => unknown) => ipcMain.handle(channel, (event, ...args) => {
    const url = event.senderFrame?.url;
    const expected = devUrl ? new URL(devUrl).origin : 'aihub://app';
    if (!window || event.sender !== window.webContents || !url || !url.startsWith(`${expected}/`)) throw new Error('拒绝来自未知页面的请求');
    return action(...args);
  });
  const stringArg = (value: unknown) => { if (typeof value !== 'string' || !value || value.length > 2048) throw new Error('无效的请求参数'); return value; };
  handle('hub:snapshot', () => engine.snapshot());
  handle('hub:connect', async value => {
    if (updateCheck || ['available', 'downloading', 'ready'].includes(engine.appUpdate.status)) throw new Error('应用更新正在进行，请完成更新后再切换服务器');
    const snapshot = await engine.connect(stringArg(value));
    checkUpdate().catch(error => log.warn(error));
    return snapshot;
  });
  handle('hub:refresh', () => engine.refresh());
  handle('hub:detail', value => engine.detail(stringArg(value)));
  handle('hub:install', value => engine.install(stringArg(value)));
  handle('hub:uninstall', value => engine.uninstall(stringArg(value)));
  handle('hub:check-update', () => checkUpdate());
  handle('hub:restart-update', async () => {
    if (engine.appUpdate.status !== 'ready') throw new Error('新版尚未下载完成');
    await engine.prepareToQuit(); quitRequested = true; autoUpdater.quitAndInstall(true, true);
  });
  handle('hub:open-admin', async () => { if (!engine.serverUrl) throw new Error('请先连接服务器'); await shell.openExternal(`${engine.serverUrl}/admin`); });
  handle('hub:open-folder', async () => { const error = await shell.openPath(engine.installRoot); if (error) throw new Error(error); });
}

async function createWindow() {
  const root = path.resolve(app.getAppPath(), 'out');
  if (!protocol.isProtocolHandled('aihub')) protocol.handle('aihub', async request => {
    const url = new URL(request.url);
    if (url.hostname !== 'app' || !['GET', 'HEAD'].includes(request.method)) return new Response('Not found', { status: 404 });
    let pathname: string;
    try { pathname = decodeURIComponent(url.pathname); } catch { return new Response('Bad path', { status: 400 }); }
    const segments = pathname.split('/');
    if (segments.some(segment => segment === '..' || segment.includes('\\') || segment.includes(':'))) return new Response('Bad path', { status: 400 });
    let file = path.resolve(root, `.${pathname}`);
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return new Response('Bad path', { status: 400 });
    try { if ((await lstat(file)).isDirectory()) file = path.join(file, 'index.html'); }
    catch { return new Response('Not found', { status: 404 }); }
    const response = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-src 'none'");
    return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers });
  });
  window = new BrowserWindow({ width: 1250, height: 830, minWidth: 980, minHeight: 650, title: 'AI Hub', icon: path.join(app.getAppPath(), 'out/icon.png'), backgroundColor: '#f6f7fb', autoHideMenuBar: true, show: process.env.AI_HUB_HEADLESS !== '1', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: process.env.AI_HUB_HEADLESS !== '1' } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, target) => {
    const expected = devUrl ? new URL(devUrl).origin : 'aihub://app';
    if (!target.startsWith(`${expected}/`)) {
      event.preventDefault();
      try { if (['http:', 'https:'].includes(new URL(target).protocol)) shell.openExternal(target).catch(error => log.warn(error)); } catch {}
    }
  });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.on('did-finish-load', () => engine.notify());
  window.on('closed', () => { window = null; });
  await window.loadURL(devUrl ?? 'aihub://app/');
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.whenReady().then(async () => {
    app.setAppUserModelId('com.aihub.desktop');
    log.initialize();
    const home = process.env.AI_HUB_TEST_MODE === '1' && process.env.AI_HUB_TEST_HOME ? path.resolve(process.env.AI_HUB_TEST_HOME) : app.getPath('home');
    engine = new SkillEngine(app.getPath('userData'), home, app.getVersion());
    await engine.init(); engine.onChange(() => { broadcast().catch(error => log.error(error)); });
    setupUpdater(); registerIpc(); await createWindow();
    engine.refresh().catch(error => log.warn('目录同步失败', error));
    checkUpdate().catch(error => log.warn(error));
  }).catch(error => { log.error(error); if (process.env.AI_HUB_HEADLESS !== '1') dialog.showErrorBox('AI Hub 无法启动', errorMessage(error)); app.exit(1); });
  app.on('before-quit', event => {
    if (!quitRequested && engine?.busy) { event.preventDefault(); engine.prepareToQuit().then(() => { quitRequested = true; app.quit(); }); }
  });
  app.on('window-all-closed', () => app.quit());
}
