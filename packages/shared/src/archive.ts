import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import { parse } from 'yaml';
import { MAX_EXPANDED_BYTES, MAX_ZIP_BYTES, validateSkillName } from './index';

export interface SkillZipInfo { name: string; description: string; markdown: string; rootPrefix: string; filesCount: number; totalBytes: number }
const MAX_ENTRIES = 10000;
const MAX_MANIFEST = 1024 * 1024;

function validateEntryName(name: string) {
  if (!name || name.includes('\\') || name.startsWith('/') || name.length > 1024) throw new Error('ZIP 包含非法路径');
  const segments = name.replace(/\/$/, '').split('/');
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..' || /[\x00-\x1f\x7f<>:"|?*]/.test(segment) || /[. ]$/.test(segment) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)) throw new Error(`ZIP 包含 Windows 非法路径：${name}`);
  }
}

async function walkZip(file: string, visit: (zip: yauzl.ZipFile, entry: yauzl.Entry) => Promise<void>): Promise<void> {
  const size = (await stat(file)).size;
  if (size > MAX_ZIP_BYTES) throw new Error('ZIP 不得超过 100 MiB');
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) { reject(error ?? new Error('无法读取 ZIP')); return; }
      let failed = false;
      const fail = (cause: unknown) => { if (!failed) { failed = true; zip.close(); reject(cause); } };
      zip.on('error', fail);
      zip.on('end', () => { if (!failed) resolve(); });
      zip.on('entry', (entry: yauzl.Entry) => {
        visit(zip, entry).then(() => { if (!failed) zip.readEntry(); }, fail);
      });
      zip.readEntry();
    });
  });
}

function streamEntry(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
  return new Promise((resolve, reject) => zip.openReadStream(entry, (error, stream) => error || !stream ? reject(error ?? new Error('解压失败')) : resolve(stream)));
}

export async function inspectSkillZip(file: string): Promise<SkillZipInfo> {
  let entries = 0, totalBytes = 0, filesCount = 0;
  const names: string[] = [];
  const seen = new Set<string>();
  const spelling = new Map<string, string>();
  const manifests = new Map<string, string>();
  await walkZip(file, async (zip, entry) => {
    if (++entries > MAX_ENTRIES) throw new Error('ZIP 文件数量超过限制');
    validateEntryName(entry.fileName);
    const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
    if (mode && mode !== 0x8000 && mode !== 0x4000) throw new Error('ZIP 不允许符号链接或特殊文件');
    if (entry.generalPurposeBitFlag & 1) throw new Error('不支持加密 ZIP');
    const key = entry.fileName.replace(/\/$/, '').toLowerCase();
    if (seen.has(key)) throw new Error('ZIP 存在重复路径');
    seen.add(key);
    const parts = entry.fileName.replace(/\/$/, '').split('/');
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join('/');
      const canonical = prefix.toLowerCase();
      if (spelling.has(canonical) && spelling.get(canonical) !== prefix) throw new Error('ZIP 路径大小写冲突');
      spelling.set(canonical, prefix);
    }
    if (entry.fileName.endsWith('/')) return;
    filesCount++;
    names.push(entry.fileName);
    if (entry.uncompressedSize > MAX_EXPANDED_BYTES || totalBytes + entry.uncompressedSize > MAX_EXPANDED_BYTES) throw new Error('解压内容不得超过 500 MiB');
    const manifest = entry.fileName === 'SKILL.md' || /^[^/]+\/SKILL\.md$/.test(entry.fileName);
    if (manifest && entry.uncompressedSize > MAX_MANIFEST) throw new Error('SKILL.md 过大');
    const chunks: Buffer[] = [];
    let bytes = 0;
    const stream = await streamEntry(zip, entry);
    for await (const chunk of stream) {
      bytes += chunk.length; totalBytes += chunk.length;
      if (totalBytes > MAX_EXPANDED_BYTES || (manifest && bytes > MAX_MANIFEST)) { stream.destroy?.(); throw new Error('解压内容超过限制'); }
      if (manifest) chunks.push(chunk);
    }
    if (bytes !== entry.uncompressedSize) throw new Error('ZIP 文件长度不一致');
    if (manifest) manifests.set(entry.fileName, Buffer.concat(chunks).toString('utf8'));
  });
  if (manifests.size !== 1) throw new Error('每个 ZIP 必须包含一个根目录或唯一顶级目录下的 SKILL.md');
  const [manifestPath, markdown] = [...manifests][0];
  const rootPrefix = manifestPath === 'SKILL.md' ? '' : manifestPath.slice(0, -'SKILL.md'.length);
  if (rootPrefix && names.some(name => !name.startsWith(rootPrefix))) throw new Error('ZIP 必须只有一个 Skill 顶级目录');
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!frontmatter) throw new Error('SKILL.md 缺少 YAML frontmatter');
  const meta = parse(frontmatter[1]) as Record<string, unknown> | null;
  validateSkillName(meta?.name);
  if (typeof meta?.description !== 'string' || !meta.description.trim() || meta.description.length > 1024) throw new Error('SKILL.md 必须提供 1–1024 字符的 description');
  return { name: meta.name, description: meta.description.trim(), markdown, rootPrefix, filesCount, totalBytes };
}

export async function extractSkillZip(file: string, destination: string): Promise<SkillZipInfo> {
  const info = await inspectSkillZip(file);
  await mkdir(destination, { recursive: false });
  let bytes = 0;
  await walkZip(file, async (zip, entry) => {
    if (!entry.fileName.startsWith(info.rootPrefix) || entry.fileName.endsWith('/')) return;
    const relative = entry.fileName.slice(info.rootPrefix.length);
    const target = path.resolve(destination, relative);
    const safe = path.relative(destination, target);
    if (!safe || safe.startsWith('..') || path.isAbsolute(safe)) throw new Error('解压路径超出目标目录');
    await mkdir(path.dirname(target), { recursive: true });
    const limiter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > MAX_EXPANDED_BYTES ? new Error('解压内容超过限制') : null, chunk);
    }});
    await pipeline(await streamEntry(zip, entry), limiter, createWriteStream(target, { flags: 'wx' }));
  });
  return info;
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
