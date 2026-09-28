import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { packTextures } from '../texture-pack.js';

const ROOT = path.resolve(import.meta.dirname, '../..');

test('the texture pack holds every texture and skin pixel for pixel, without overlaps', () => {
  const { png, json } = packTextures(ROOT);
  const sheet = PNG.sync.read(png);
  const map = JSON.parse(json);
  const rects = Object.entries(map);
  assert.ok(map['environment/moon'] && map['skins/FroggyMiner'], 'textures and skins are in the pack');
  for (const [name, [x, y, w, h]] of rects) {
    const file = name.startsWith('skins/') ? path.join(ROOT, 'public', `${name}.png`) : path.join(ROOT, 'public/textures', `${name}.png`);
    const src = PNG.sync.read(fs.readFileSync(file));
    assert.deepEqual([w, h], [src.width, src.height], name);
    for (let row = 0; row < h; row++) {
      const a = sheet.data.subarray(((y + row) * sheet.width + x) * 4, ((y + row) * sheet.width + x + w) * 4);
      const b = src.data.subarray(row * w * 4, (row + 1) * w * 4);
      assert.ok(Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0, `${name}, row ${row}`);
    }
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const [, [ax, ay, aw, ah]] = rects[i], [, [bx, by, bw, bh]] = rects[j];
      assert.ok(ax + aw <= bx || bx + bw <= ax || ay + ah <= by || by + bh <= ay, `${rects[i][0]} overlaps ${rects[j][0]}`);
    }
  }
});
