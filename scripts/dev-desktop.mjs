import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import './build-electron.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const next = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--port', '3001'], { cwd: path.join(root, 'apps/desktop'), stdio: 'inherit' });
let electron;
const cleanup = () => { next.kill(); electron?.kill(); };
process.on('SIGINT', cleanup); process.on('SIGTERM', cleanup); process.on('exit', cleanup);
for (let i = 0; i < 120; i++) {
  if (next.exitCode !== null) throw new Error('客户端页面服务启动失败');
  try { const response = await fetch('http://127.0.0.1:3001'); if (response.ok) break; } catch {}
  if (i === 119) throw new Error('客户端页面服务启动超时');
  await new Promise(resolve => setTimeout(resolve, 500));
}
const env = { ...process.env, AI_HUB_DEV_URL: 'http://127.0.0.1:3001' };
delete env.ELECTRON_RUN_AS_NODE;
electron = spawn(require('electron'), [path.join(root, 'apps/desktop')], { cwd: root, env, stdio: 'inherit' });
electron.on('exit', code => { cleanup(); process.exitCode = code ?? 0; });
