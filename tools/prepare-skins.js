// Detects each bot's skin model, stores it in source/bots.json and copies skins to public/skins/.
import fs from 'node:fs';
import path from 'node:path';
import { detectSkinModel } from './lib/skin.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const botsFile = path.join(ROOT, 'source/bots.json');
const config = JSON.parse(fs.readFileSync(botsFile, 'utf8'));
const outDir = path.join(ROOT, 'public/skins');
fs.mkdirSync(outDir, { recursive: true });

for (const bot of config.bots) {
  const src = path.join(ROOT, 'source', bot.skin);
  const buf = fs.readFileSync(src);
  bot.model = detectSkinModel(buf);
  fs.copyFileSync(src, path.join(outDir, path.basename(src)));
  console.log(`${bot.nick}: ${bot.model}`);
}
fs.writeFileSync(botsFile, JSON.stringify(config, null, 2).replace(/\{\n\s+("nick"[^}]+)\n\s+\}/g, (m, body) => `{ ${body.replace(/\n\s+/g, ' ')} }`) + '\n');
