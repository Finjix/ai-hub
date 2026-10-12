import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Official Century Games wordmark (white, with green A crossbar) is a PNG embedded in the SVG.
const svg = await readFile(path.join(root, 'assets/centurygames-logo.svg'), 'utf8');
const source = Buffer.from(svg.match(/base64,([A-Za-z0-9+/=]+)/)[1], 'base64');
// Recolour the white letters to ink, leaving the green crossbar untouched.
const { data, info } = await sharp(source).trim().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
for (let i = 0; i < data.length; i += 4) if (Math.max(data[i], data[i+1], data[i+2]) - Math.min(data[i], data[i+1], data[i+2]) < 40) data[i] = data[i+1] = data[i+2] = 0;
const wordmark = await sharp(data, { raw: info }).png().toBuffer();
// Transparent square with the wordmark centred.
async function tile(size) {
  const logo = await sharp(wordmark).resize({ width: Math.round(size * .9) }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: logo, gravity: 'center' }]).png().toBuffer();
}
const sizes=[16,32,48,256],images=await Promise.all(sizes.map(tile)),header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);let offset=header.length;
for(let i=0;i<sizes.length;i++){const entry=6+i*16;header[entry]=sizes[i]===256?0:sizes[i];header[entry+1]=header[entry];header.writeUInt16LE(1,entry+4);header.writeUInt16LE(32,entry+6);header.writeUInt32LE(images[i].length,entry+8);header.writeUInt32LE(offset,entry+12);offset+=images[i].length;}
await mkdir(path.join(root,'apps/desktop/build'),{recursive:true});await writeFile(path.join(root,'apps/desktop/build/icon.ico'),Buffer.concat([header,...images]));
const brand = await sharp(wordmark).resize({ height: 64 }).png().toBuffer();
for(const app of ['desktop','server']){await mkdir(path.join(root,`apps/${app}/public`),{recursive:true});await writeFile(path.join(root,`apps/${app}/public/icon.png`),images[3]);await writeFile(path.join(root,`apps/${app}/public/brand-logo.png`),brand);}
