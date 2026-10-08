import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktop = path.join(root, 'apps', 'desktop');
await build({ entryPoints: [path.join(desktop, 'electron/main.ts')], outfile: path.join(desktop, 'dist/main.cjs'), bundle: true, platform: 'node', target: 'node22', format: 'cjs', sourcemap: true, external: ['electron', 'electron-updater', 'electron-log'] });
await build({ entryPoints: [path.join(desktop, 'electron/preload.ts')], outfile: path.join(desktop, 'dist/preload.cjs'), bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['electron'] });
