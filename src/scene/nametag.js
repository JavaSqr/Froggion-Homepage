// Name tag above an entity: white text on a 25% black plate, 0.025 blocks per pixel like the game.
import { CanvasTexture, LinearFilter, Sprite, SpriteMaterial } from 'three';

const PX = 0.025;
const OVERSAMPLE = 6;

export function createNameTag(text, font = 'Handjet') {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const fontSize = 9 * OVERSAMPLE;
  const setFont = () => { ctx.font = `700 ${fontSize}px ${font}, ui-monospace, monospace`; };
  setFont();
  const textW = Math.ceil(ctx.measureText(text).width / OVERSAMPLE);
  const w = textW + 2, h = 10;
  canvas.width = w * OVERSAMPLE;
  canvas.height = h * OVERSAMPLE;
  setFont();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + OVERSAMPLE * 0.5);
  const tex = new CanvasTexture(canvas);
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  const sprite = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  sprite.scale.set(w * PX, h * PX, 1);
  sprite.renderOrder = 5;
  return sprite;
}
