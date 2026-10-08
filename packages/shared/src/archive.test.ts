import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ZipFile } from 'yazl';
import { extractSkillZip, inspectSkillZip } from './archive';
import { isNewerVersion, normalizeServerUrl, validateSkillName } from './index';

const roots: string[] = [];
async function fixture(entries: Array<{ name: string; text: string; mode?: number }>) {
  const root = await mkdtemp(path.join(tmpdir(), 'ai-hub-archive-')); roots.push(root);
  const zip = new ZipFile();
  for (const entry of entries) zip.addBuffer(Buffer.from(entry.text), entry.name, { mode: entry.mode });
  zip.end(); const chunks: Buffer[] = []; for await (const chunk of zip.outputStream) chunks.push(Buffer.from(chunk));
  const file = path.join(root, 'skill.zip'); await writeFile(file, Buffer.concat(chunks)); return { file, root };
}
const manifest = '---\nname: review-helper\ndescription: Review code changes\n---\n# Review\nRead the diff first.';
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
describe('skill packages', () => {
  it('normalizes a wrapper directory and preserves supporting files', async () => {
    const { file, root } = await fixture([{ name: 'bundle/SKILL.md', text: manifest }, { name: 'bundle/scripts/check.ts', text: 'supporting file' }]);
    const info = await extractSkillZip(file, path.join(root, 'installed'));
    expect(info.name).toBe('review-helper'); expect(info.rootPrefix).toBe('bundle/');
    expect(await readFile(path.join(root, 'installed/scripts/check.ts'), 'utf8')).toBe('supporting file');
  });
  it('rejects multiple skills and files outside a wrapper', async () => {
    const one = await fixture([{ name: 'one/SKILL.md', text: manifest }, { name: 'two/SKILL.md', text: manifest }]);
    await expect(inspectSkillZip(one.file)).rejects.toThrow('一个');
    const two = await fixture([{ name: 'one/SKILL.md', text: manifest }, { name: 'other.txt', text: 'bad' }]);
    await expect(inspectSkillZip(two.file)).rejects.toThrow('顶级目录');
  });
  it('rejects Windows reserved paths, conflicting case and symlinks', async () => {
    for (const entry of [{ name: 'CON.txt', text: 'bad' }, { name: 'link', text: 'target', mode: 0o120777 }]) {
      const { file } = await fixture([{ name: 'SKILL.md', text: manifest }, entry]); await expect(inspectSkillZip(file)).rejects.toThrow();
    }
    const { file } = await fixture([{ name: 'SKILL.md', text: manifest }, { name: 'assets/A.txt', text: 'one' }, { name: 'assets/a.txt', text: 'two' }]);
    await expect(inspectSkillZip(file)).rejects.toThrow('重复');
  });
  it('rejects archive path traversal before creating any output', async () => {
    const { file, root } = await fixture([{ name: 'SKILL.md', text: manifest }, { name: 'aa/evil.txt', text: 'bad' }]);
    const bytes = await readFile(file);
    for (let offset = bytes.indexOf('aa/evil.txt'); offset !== -1; offset = bytes.indexOf('aa/evil.txt', offset + 1)) bytes.write('../evil.txt', offset);
    await writeFile(file, bytes);
    await expect(extractSkillZip(file, path.join(root, 'installed'))).rejects.toThrow();
  });
  it('requires a valid skill manifest', async () => {
    for (const text of ['# no manifest', '---\nname: nul\ndescription: bad\n---\ntext', '---\nname: hello\ndescription: 123\n---\ntext']) {
      const { file } = await fixture([{ name: 'SKILL.md', text }]); await expect(inspectSkillZip(file)).rejects.toThrow();
    }
  });
});
describe('source and version boundaries', () => {
  it('uses semver ordering without downgrading', () => { expect(isNewerVersion('1.10.0', '1.9.0')).toBe(true); expect(isNewerVersion('1.0.0', '2.0.0')).toBe(false); expect(isNewerVersion('bad', '1.0.0')).toBe(false); });
  it('accepts server origins only', () => { expect(normalizeServerUrl('http://192.168.1.10:3000/')).toBe('http://192.168.1.10:3000'); for (const url of ['file:///tmp', 'http://a/user', 'http://user:pass@a', 'https://a/#bad']) expect(() => normalizeServerUrl(url)).toThrow(); });
  it('rejects names that could escape a Windows install directory', () => { for (const name of ['../x', '.system', 'A', 'con', 'a\\b', 'a.']) expect(() => validateSkillName(name)).toThrow(); });
});
