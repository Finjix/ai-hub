import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = process.env.AI_HUB_CODEX_EXE || process.argv[2];
if (!executable) throw new Error('请传入 Codex CLI 的路径，或设置 AI_HUB_CODEX_EXE');
const temporary = await mkdtemp(path.join(tmpdir(), 'ai-hub-codex-'));
const codexHome = path.join(temporary, '.codex');
await mkdir(path.join(codexHome, 'skills/review-helper'), { recursive: true });
await writeFile(path.join(codexHome, 'skills/review-helper/SKILL.md'), await readFile(path.join(root, 'examples/review-helper/SKILL.md')));
await writeFile(path.join(codexHome, 'config.toml'), '[analytics]\nenabled = false\n');
const child = spawn(executable, ['app-server', '--stdio'], { cwd: temporary, env: { ...process.env, CODEX_HOME: codexHome, USERPROFILE: temporary, HOME: temporary }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
const pending = new Map();
let diagnostics = '';
child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-10000); });
const lines = createInterface({ input: child.stdout });
lines.on('line', line => { try { const response = JSON.parse(line); const resolve = pending.get(response.id); if (resolve) { pending.delete(response.id); resolve(response); } } catch {} });
function request(id, method, params) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Codex ${method} timed out`)); }, 30000);
    pending.set(id, response => { clearTimeout(timer); response.error ? reject(new Error(JSON.stringify(response.error))) : resolve(response.result); });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
}
try {
  const initialized = await request(0, 'initialize', { clientInfo: { name: 'ai_hub_verification', title: 'AI Hub verification', version: '0.1.0' } });
  child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
  const result = await request(1, 'skills/list', { cwds: [temporary], forceReload: true });
  const found = result.data?.flatMap(item => item.skills ?? []).find(skill => skill.name === 'review-helper');
  const report = { verifiedAt: new Date().toISOString(), userAgent: initialized.userAgent, codexDirectory: '.codex/skills', recognized: !!found, recognizedScope: found?.scope, errors: result.data?.flatMap(item => item.errors ?? []) };
  await mkdir(path.join(root, 'artifacts/verification'), { recursive: true }); await writeFile(path.join(root, 'artifacts/verification/codex-skills.json'), JSON.stringify(report, null, 2));
  assert.ok(found, '当前 Codex 未自动识别 .codex/skills 中的用户技能');
  console.log(`PASS: bundled Codex recognizes review-helper in isolated .codex/skills (${initialized.userAgent ?? 'app-server'})`);
} catch (error) { if (diagnostics) console.error(diagnostics); throw error; }
finally { lines.close(); child.stdin.end(); if (child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited; } const relative = path.relative(tmpdir(), temporary); if (!relative.startsWith('..') && relative.startsWith('ai-hub-codex-')) await rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 }); }
