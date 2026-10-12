import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { context } from 'esbuild';
import { electronBuilds } from './electron-build-options.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const next = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--port', '3001'], { cwd: path.join(root, 'apps/desktop'), stdio: 'inherit' });
let electron, restarting = false, timer, contexts = [];
const cleanup = () => { next.kill(); electron?.kill(); for (const ctx of contexts) ctx.dispose().catch(() => {}); };
process.on('SIGINT', cleanup); process.on('SIGTERM', cleanup); process.on('exit', cleanup);
const env = { ...process.env, AI_HUB_DEV_URL: 'http://127.0.0.1:3001' };
delete env.ELECTRON_RUN_AS_NODE;
function startElectron() {
  electron = spawn(require('electron'), [path.join(root, 'apps/desktop')], { cwd: root, env, stdio: 'inherit' });
  electron.on('exit', code => {
    // A watch rebuild killed it on purpose; otherwise the user closed the app, so end the dev session.
    if (restarting) { restarting = false; startElectron(); return; }
    cleanup(); process.exitCode = code ?? 0;
  });
}
// Main and preload rebuild separately; debounce so one save restarts Electron once.
const restartElectron = () => { clearTimeout(timer); timer = setTimeout(() => {
  if (!electron || electron.exitCode !== null) return startElectron();
  console.log('[dev] Electron 代码已变更，正在重启客户端…');
  restarting = true; electron.kill();
}, 200); };
// watch() does its own initial build: the first result per context only signals readiness, later ones restart Electron.
const ready = [];
contexts = await Promise.all(electronBuilds.map(options => {
  let first = true, resolve, reject;
  ready.push(new Promise((ok, fail) => { resolve = ok; reject = fail; }));
  const reload = { name: 'reload-electron', setup(build) { build.onEnd(result => {
    if (first) { first = false; return result.errors.length ? reject(new Error('Electron 主进程编译失败')) : resolve(); }
    if (!result.errors.length) restartElectron();
  }); } };
  return context({ ...options, plugins: [reload] });
}));
await Promise.all(contexts.map(ctx => ctx.watch()));
await Promise.all(ready);
for (let i = 0; i < 120; i++) {
  if (next.exitCode !== null) throw new Error('客户端页面服务启动失败');
  try { const response = await fetch('http://127.0.0.1:3001'); if (response.ok) break; } catch {}
  if (i === 119) throw new Error('客户端页面服务启动超时');
  await new Promise(resolve => setTimeout(resolve, 500));
}
startElectron();
