import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Output is piped for prefixing, so force colours that would otherwise be dropped without a TTY.
const env = { ...process.env, FORCE_COLOR: '1' };
const apps = [{ name: 'server', color: 36 }, { name: 'desktop', color: 35 }];
let stopping = false;
const children = apps.map(({ name, color }) => {
  const tag = `\x1b[${color}m[${name}]\x1b[0m `;
  const child = spawn(`npm run dev:${name}`, { cwd: root, env, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', line => console.log(tag + line));
  }
  child.on('exit', code => {
    if (stopping) return;
    // Closing Electron or a crash in either process ends the whole dev session.
    console.log(`${tag}已退出（代码 ${code ?? 0}），正在停止其他开发进程…`);
    stop(code ?? 0);
  });
  return child;
});
function stop(code) {
  if (stopping) return;
  stopping = true;
  // child.kill() only ends the shell on Windows; taskkill /T also ends Next.js and Electron.
  for (const child of children) {
    if (child.exitCode === null) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  }
  process.exit(code);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
