import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = path.join(root, 'apps/server');
const output = path.join(server, '.next/standalone/apps/server');
await mkdir(output, { recursive: true });
await cp(path.join(server, '.next/static'), path.join(output, '.next/static'), { recursive: true });
try { await cp(path.join(server, 'public'), path.join(output, 'public'), { recursive: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
