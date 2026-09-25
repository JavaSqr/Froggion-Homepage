// Logo and favicons from source/brand/ into public/.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const icon = path.join(ROOT, 'source/brand/froggion-icon-white-noeyes.png');
const out = path.join(ROOT, 'public');
fs.mkdirSync(path.join(out, 'brand'), { recursive: true });

const trimmed = await sharp(icon).trim().png().toBuffer();

// White mark for the header, 2x of its CSS size.
await sharp(trimmed).resize({ height: 80, fit: 'inside' }).png({ compressionLevel: 9, palette: true }).toFile(path.join(out, 'brand/logo.png'));

// Favicons: the white mark on a dark green tile, so it reads on light and dark tabs.
async function tile(size, radius, pad) {
  const inner = Math.round(size * (1 - pad * 2));
  const mark = await sharp(trimmed).resize({ width: inner, height: inner, fit: 'inside' }).toBuffer();
  const meta = await sharp(mark).metadata();
  const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="#1f3a24"/></svg>`);
  return sharp(bg).composite([{ input: mark, left: Math.round((size - meta.width) / 2), top: Math.round((size - meta.height) / 2) }]).png({ compressionLevel: 9 });
}
await (await tile(32, 6, 0.14)).toFile(path.join(out, 'favicon-32.png'));
await (await tile(180, 36, 0.16)).toFile(path.join(out, 'apple-touch-icon.png'));
await (await tile(192, 38, 0.16)).toFile(path.join(out, 'icon-192.png'));
await (await tile(512, 100, 0.16)).toFile(path.join(out, 'icon-512.png'));
// Panel screenshots for the "Панель" section: WebP in two widths for srcset.
const PANEL = {
  status: 'ScreenShot Tool -20260925192911.png',
  inventory: 'ScreenShot Tool -20260925193032.png',
  chat: 'ScreenShot Tool -20260925193054.png',
};
fs.mkdirSync(path.join(out, 'panel'), { recursive: true });
for (const [id, file] of Object.entries(PANEL)) {
  for (const width of [960, 560]) {
    const dest = path.join(out, 'panel', `${id}-${width}.webp`);
    await sharp(path.join(ROOT, 'source/brand', file)).resize({ width }).webp({ quality: 72, effort: 6 }).toFile(dest);
    console.log(path.relative(ROOT, dest), `${(fs.statSync(dest).size / 1024).toFixed(1)} KB`);
  }
}
console.log('brand assets written');
