import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cp, mkdir, readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { ZipFile } from 'yazl';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
const runtime = process.env.AI_HUB_NODE_EXE || process.execPath;
const runtimeVersion = execFileSync(runtime, ['--version'], { encoding: 'utf8' }).trim();
if (process.platform !== 'win32' || process.arch !== 'x64' || runtimeVersion !== 'v24.21.0') throw new Error('便携服务端打包需要 Windows x64 Node.js 24.21.0；可通过 AI_HUB_NODE_EXE 指定运行时');
const source = path.join(root, 'apps/server/.next/standalone');
await stat(path.join(source, 'apps/server/server.js'));
const artifactRoot = path.join(root, 'artifacts/server');
await mkdir(artifactRoot, { recursive: true });
const name = `ai-hub-server-${version}-win-x64`;
const output = path.join(artifactRoot, `${name}-${Date.now()}`);
await mkdir(output);
await mkdir(path.join(output, 'runtime'));
await cp(runtime, path.join(output, 'runtime/node.exe'));
const licenseResponse = await fetch('https://raw.githubusercontent.com/nodejs/node/v24.x/LICENSE', { signal: AbortSignal.timeout(30000) });
if (!licenseResponse.ok) throw new Error('无法获取 Node.js 许可证，请检查网络后重试');
await writeFile(path.join(output, 'runtime/LICENSE'), await licenseResponse.text());
await cp(source, path.join(output, 'app'), { recursive: true, dereference: true });
await cp(path.join(root, 'apps/server/.next/static'), path.join(output, 'app/apps/server/.next/static'), { recursive: true });
try { await cp(path.join(root, 'apps/server/public'), path.join(output, 'app/apps/server/public'), { recursive: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(path.join(output, 'data/logs'), { recursive: true });
const launcher = `@echo off\r\nsetlocal\r\ncd /d "%~dp0"\r\nset "AI_HUB_DATA_DIR=%~dp0data"\r\nset "HOSTNAME=0.0.0.0"\r\nif not defined PORT set "PORT=3000"\r\nif not exist "%~dp0data\\logs" mkdir "%~dp0data\\logs"\r\necho AI Hub: http://localhost:%PORT%/admin\r\necho Press Ctrl+C to stop. Log: data\\logs\\server.log\r\n"%~dp0runtime\\node.exe" "%~dp0app\\apps\\server\\server.js" >> "%~dp0data\\logs\\server.log" 2>&1\r\nif errorlevel 1 (\r\n  type "%~dp0data\\logs\\server.log"\r\n  pause\r\n)\r\nendlocal\r\n`;
await writeFile(path.join(output, 'start-server.cmd'), launcher, 'ascii');
await cp(path.join(root, 'docs/portable-server.md'), path.join(output, '使用说明.md'));
await writeFile(path.join(output, 'runtime/version.txt'), `${runtimeVersion}\r\nWindows x64\r\n`);
const notices = [];
async function walk(directory, callback) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(absolute, callback);
    else if (entry.isFile()) await callback(absolute);
  }
}
await walk(path.join(output, 'app'), async file => {
  if (path.basename(file) !== 'package.json') return;
  try {
    const meta = JSON.parse(await readFile(file, 'utf8'));
    if (!meta.name || meta.private) return;
    for (const license of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md']) {
      try { notices.push(`${meta.name}@${meta.version}\n${await readFile(path.join(path.dirname(file), license), 'utf8')}\n`); break; } catch {}
    }
  } catch {}
});
await writeFile(path.join(output, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n---\n'));
const zip = new ZipFile();
await walk(output, async file => zip.addFile(file, `${name}/${path.relative(output, file).split(path.sep).join('/')}`));
zip.end();
const archive = path.join(artifactRoot, `${name}.zip`);
await pipeline(zip.outputStream, createWriteStream(archive));
await writeFile(path.join(artifactRoot, 'latest-build.json'), JSON.stringify({ directory: output, archive, runtimeVersion }, null, 2));
console.log(`Portable server: ${archive}\nDirectory: ${output}\nRuntime: ${runtimeVersion}`);
