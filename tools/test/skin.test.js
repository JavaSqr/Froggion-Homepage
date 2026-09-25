import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { detectSkinModel } from '../lib/skin.js';

function skin(width, height, clearSlimStrip) {
  const png = new PNG({ width, height });
  png.data.fill(255);
  if (clearSlimStrip) {
    for (let y = 20; y <= 31; y++) for (let x = 54; x <= 55; x++) png.data[(y * width + x) * 4 + 3] = 0;
  }
  return PNG.sync.write(png);
}

test('opaque arm strip is classic', () => {
  assert.equal(detectSkinModel(skin(64, 64, false)), 'classic');
});

test('transparent x 54–55, y 20–31 is slim', () => {
  assert.equal(detectSkinModel(skin(64, 64, true)), 'slim');
});

test('a single opaque pixel in the strip keeps it classic', () => {
  const png = PNG.sync.read(skin(64, 64, true));
  png.data[(31 * 64 + 55) * 4 + 3] = 255;
  assert.equal(detectSkinModel(PNG.sync.write(png)), 'classic');
});

test('legacy 64×32 skins are classic', () => {
  assert.equal(detectSkinModel(skin(64, 32, false)), 'classic');
});
