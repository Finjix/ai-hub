import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const table = Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crc32(bytes) { let value = 0xffffffff; for (const byte of bytes) value = table[(value ^ byte) & 255] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const name = Buffer.from(type); const output = Buffer.alloc(data.length + 12); output.writeUInt32BE(data.length); name.copy(output, 4); data.copy(output, 8); output.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8); return output; }
// Same shape as the in-app mark: ink tile, white "A", Century Games green crossbar (32-unit grid).
const letter = [[6.5,25],[13.4,7],[18.6,7],[25.5,25],[20.9,25],[16,11.6],[11.1,25]].map(([x, y]) => [x / 32, y / 32]);
const bar = [9.6 / 32, 18.4 / 32, 19 / 32, 21.7 / 32];
function inside(polygon, x, y) { let hit = false; for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) { const [xi, yi] = polygon[i], [xj, yj] = polygon[j]; if ((yi > y) !== (yj > y) && x < (xj-xi)*(y-yi)/(yj-yi)+xi) hit = !hit; } return hit; }
const samples = [.125,.375,.625,.875];
function png(size) {
  const bytes = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let red=0,green=0,blue=0,alpha=0;
    for (const dx of samples) for (const dy of samples) {
      const u=(x+dx)/size,v=(y+dy)/size,r=7/32;
      const cx=Math.max(r,Math.min(1-r,u)),cy=Math.max(r,Math.min(1-r,v));
      if (Math.hypot(u-cx,v-cy)>r) continue;
      const [cr,cg,cb]=u>=bar[0]&&u<=bar[2]&&v>=bar[1]&&v<=bar[3]?[59,255,147]:inside(letter,u,v)?[255,255,255]:[42,42,42];
      red+=cr; green+=cg; blue+=cb; alpha++;
    }
    const offset=y*(size*4+1)+1+x*4;
    if(alpha){bytes[offset]=Math.round(red/alpha);bytes[offset+1]=Math.round(green/alpha);bytes[offset+2]=Math.round(blue/alpha);bytes[offset+3]=Math.round(alpha/samples.length**2*255);}
  }
  const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(bytes)),chunk('IEND',Buffer.alloc(0))]);
}
const sizes=[16,32,48,256],images=sizes.map(png),header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);let offset=header.length;
for(let i=0;i<sizes.length;i++){const entry=6+i*16;header[entry]=sizes[i]===256?0:sizes[i];header[entry+1]=header[entry];header.writeUInt16LE(1,entry+4);header.writeUInt16LE(32,entry+6);header.writeUInt32LE(images[i].length,entry+8);header.writeUInt32LE(offset,entry+12);offset+=images[i].length;}
await mkdir(path.join(root,'apps/desktop/build'),{recursive:true});await writeFile(path.join(root,'apps/desktop/build/icon.ico'),Buffer.concat([header,...images]));
for(const app of ['desktop','server']){await mkdir(path.join(root,`apps/${app}/public`),{recursive:true});await writeFile(path.join(root,`apps/${app}/public/icon.png`),images[3]);}
