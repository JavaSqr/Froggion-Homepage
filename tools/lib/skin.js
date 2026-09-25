// Classic vs slim: slim skins leave x 54–55, y 20–31 (the unused strip of the right arm) transparent.
import { PNG } from 'pngjs';

export function detectSkinModel(pngBuffer) {
  const png = PNG.sync.read(pngBuffer);
  if (png.width !== 64 || png.height !== 64) return 'classic';
  for (let y = 20; y <= 31; y++) {
    for (let x = 54; x <= 55; x++) {
      if (png.data[(y * png.width + x) * 4 + 3] !== 0) return 'classic';
    }
  }
  return 'slim';
}
