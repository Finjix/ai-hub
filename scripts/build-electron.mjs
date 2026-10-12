import { build } from 'esbuild';
import { electronBuilds } from './electron-build-options.mjs';
await Promise.all(electronBuilds.map(options => build(options)));
