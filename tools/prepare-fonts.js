// Fonts for the site, into src/fonts/:
//   pixel.woff        «Minecraft 1.1» by Pwnage_Block (CC BY-SA 3.0), from source/fonts/Minecraft_1.1.ttf,
//                     repacked as WOFF with the glyphs, names and license notice unchanged;
//   pixel-extra.woff  our own glyphs in the same 8-pixel grid for signs the font lacks (₽ — « » → …),
//                     used only for those characters (unicode-range in main.css).
//   node tools/prepare-fonts.js
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'source/fonts');
const OUT = path.join(ROOT, 'src/fonts');

function readSfnt(buf) {
  const flavor = buf.readUInt32BE(0);
  const count = buf.readUInt16BE(4);
  const tables = new Map();
  for (let i = 0; i < count; i++) {
    const o = 12 + i * 16;
    const tag = buf.toString('latin1', o, o + 4);
    const offset = buf.readUInt32BE(o + 8), length = buf.readUInt32BE(o + 12);
    tables.set(tag, Buffer.from(buf.subarray(offset, offset + length)));
  }
  return { flavor, tables };
}

function checksum(data) {
  const padded = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0;
  return sum;
}

// WOFF 1.0: header, table directory, zlib-compressed tables.
function writeWoff({ flavor, tables }) {
  const tags = [...tables.keys()].sort();
  const entries = tags.map((tag) => {
    const data = tables.get(tag);
    const z = zlib.deflateSync(data, { level: 9 });
    return { tag, data, stored: z.length < data.length ? z : data };
  });
  const pad4 = (n) => (n + 3) & ~3;
  let offset = 44 + entries.length * 20;
  let sfntSize = 12 + entries.length * 16;
  for (const e of entries) { e.offset = offset; offset += pad4(e.stored.length); sfntSize += pad4(e.data.length); }
  const out = Buffer.alloc(offset);
  out.write('wOFF', 0, 'latin1');
  out.writeUInt32BE(flavor, 4);
  out.writeUInt32BE(offset, 8);
  out.writeUInt16BE(entries.length, 12);
  out.writeUInt32BE(sfntSize, 16);
  out.writeUInt16BE(1, 20);
  entries.forEach((e, i) => {
    const o = 44 + i * 20;
    out.write(e.tag, o, 'latin1');
    out.writeUInt32BE(e.offset, o + 4);
    out.writeUInt32BE(e.stored.length, o + 8);
    out.writeUInt32BE(e.data.length, o + 12);
    out.writeUInt32BE(checksum(e.data), o + 16);
    e.stored.copy(out, e.offset);
  });
  return out;
}

// ---------- the extra glyphs ----------

// Rows from the top; the row marked by `base` sits on the baseline. One pixel = 128 units, 8 per em,
// like the main font (cap height 7 pixels, the middle of lowercase at row 2 above the baseline).
const GLYPHS = {
  0x20bd: { advance: 6, base: 6, rows: ['.###.', '.#..#', '.#..#', '.###.', '.#...', '###..', '.#...'] }, // ₽
  0x2014: { advance: 9, base: 2, rows: ['########', '........', '........'] }, // —
  0x2013: { advance: 7, base: 2, rows: ['######', '......', '......'] }, // –
  0x2212: { advance: 6, base: 2, rows: ['#####', '.....', '.....'] }, // −
  0x00ab: { advance: 5, base: 3, rows: ['.#.#', '#.#.', '.#.#', '....'] }, // «
  0x00bb: { advance: 5, base: 3, rows: ['#.#.', '.#.#', '#.#.', '....'] }, // »
  0x2192: { advance: 8, base: 4, rows: ['....#..', '.....#.', '#######', '.....#.', '....#..'] }, // →
  0x00d7: { advance: 6, base: 4, rows: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'] }, // ×
  0x2026: { advance: 6, base: 1, rows: ['#.#.#', '#.#.#'] }, // …
  0x00b7: { advance: 2, base: 3, rows: ['#', '#', '.', '.'] }, // ·
  0x00a9: { advance: 8, base: 6, rows: ['.#####.', '#.....#', '#.###.#', '#.#...#', '#.###.#', '#.....#', '.#####.'] }, // ©
  0x00a0: { advance: 2, base: 0, rows: [] }, // no-break space
  0x202f: { advance: 2, base: 0, rows: [] }, // narrow no-break space (thousands in ru-RU prices)
};
const PX = 128, EM = 1024;

// A glyph as rectangles: runs of pixels in each row.
function contoursOf({ base, rows }) {
  const rects = [];
  rows.forEach((row, i) => {
    const y = (base - i) * PX;
    for (let x = 0; x < row.length;) {
      if (row[x] !== '#') { x++; continue; }
      let w = 0;
      while (row[x + w] === '#') w++;
      rects.push([x * PX, y, (x + w) * PX, y + PX]);
      x += w;
    }
  });
  // Clockwise, as TrueType fills outer contours.
  return rects.map(([x0, y0, x1, y1]) => [[x0, y0], [x0, y1], [x1, y1], [x1, y0]]);
}

function glyphData(contours) {
  if (!contours.length) return { data: Buffer.alloc(0), box: [0, 0, 0, 0], points: 0 };
  const pts = contours.flat();
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const head = Buffer.alloc(10 + contours.length * 2 + 2);
  head.writeInt16BE(contours.length, 0);
  box.forEach((v, i) => head.writeInt16BE(v, 2 + i * 2));
  contours.forEach((_, i) => head.writeUInt16BE((i + 1) * 4 - 1, 10 + i * 2));
  head.writeUInt16BE(0, 10 + contours.length * 2); // no instructions
  const flags = Buffer.alloc(pts.length, 1); // on-curve, 16-bit deltas
  const coords = Buffer.alloc(pts.length * 4);
  let px = 0, py = 0;
  pts.forEach(([x, y], i) => { coords.writeInt16BE(x - px, i * 2); px = x; });
  pts.forEach(([x, y], i) => { coords.writeInt16BE(y - py, pts.length * 2 + i * 2); py = y; });
  let data = Buffer.concat([head, flags, coords]);
  if (data.length % 4) data = Buffer.concat([data, Buffer.alloc(4 - (data.length % 4))]);
  return { data, box, points: pts.length, contours: contours.length };
}

function u16(...values) { const b = Buffer.alloc(values.length * 2); values.forEach((v, i) => b.writeUInt16BE(v & 0xffff, i * 2)); return b; }
function i16(v) { const b = Buffer.alloc(2); b.writeInt16BE(v); return b; }
function u32(v) { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); return b; }

function buildExtraFont() {
  const codes = Object.keys(GLYPHS).map(Number).sort((a, b) => a - b);
  const glyphs = [{ advance: 2 * PX, g: glyphData([]) }, ...codes.map((c) => ({ code: c, advance: GLYPHS[c].advance * PX, g: glyphData(contoursOf(GLYPHS[c])) }))];
  const n = glyphs.length;

  const glyf = Buffer.concat(glyphs.map((x) => x.g.data));
  const offsets = [0];
  for (const x of glyphs) offsets.push(offsets.at(-1) + x.g.data.length);
  const loca = Buffer.concat(offsets.map((o) => u32(o)));
  const hmtx = Buffer.concat(glyphs.map((x) => Buffer.concat([u16(x.advance), i16(x.g.box[0])])));
  const boxes = glyphs.filter((x) => x.g.points).map((x) => x.g.box);
  const bbox = [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))];

  const head = Buffer.concat([
    u32(0x00010000), u32(0x00010000), u32(0), u32(0x5f0f3cf5), u16(0x000b, EM),
    Buffer.alloc(16), // created, modified
    i16(bbox[0]), i16(bbox[1]), i16(bbox[2]), i16(bbox[3]),
    u16(0, 8), i16(2), i16(1), i16(0), // macStyle, lowestRecPPEM, fontDirectionHint, indexToLocFormat (long), glyphDataFormat
  ]);
  const hhea = Buffer.concat([
    u32(0x00010000), i16(896), i16(-128), i16(0), u16(Math.max(...glyphs.map((x) => x.advance))),
    i16(0), i16(0), i16(bbox[2]), i16(1), i16(0), i16(0), Buffer.alloc(8), i16(0), u16(n),
  ]);
  const maxp = Buffer.concat([
    u32(0x00010000), u16(n), u16(Math.max(...glyphs.map((x) => x.g.points))), u16(Math.max(...glyphs.map((x) => x.g.contours ?? 0))),
    u16(0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0),
  ]);
  const os2 = Buffer.concat([
    u16(4), i16(6 * PX), u16(400, 5, 0), // version, xAvgCharWidth, weight, width, fsType: installable
    i16(512), i16(512), i16(0), i16(128), i16(512), i16(512), i16(0), i16(512), i16(64), i16(128), i16(0), // sub/superscript, strikeout
    Buffer.alloc(10), // panose
    u32(0x00000003), u32(0x00002000), u32(0), u32(0), // unicode ranges: Latin, Latin-1, general punctuation
    Buffer.from('FRGN'), u16(0x0040, codes[0], codes.at(-1)), // fsSelection: regular
    i16(896), i16(-128), i16(0), u16(1152, 128), // typo and win metrics, as in the main font
    u32(0x00000001), u32(0), i16(640), i16(896), u16(0, 32, 1),
  ]);
  // cmap: format 4, one segment per character.
  const segs = [...codes.map((c, i) => ({ start: c, end: c, delta: (i + 1 - c) & 0xffff })), { start: 0xffff, end: 0xffff, delta: 1 }];
  const segX2 = segs.length * 2;
  const searchRange = 2 * 2 ** Math.floor(Math.log2(segs.length));
  const sub = Buffer.concat([
    u16(4, 0, 0, segX2, searchRange, Math.floor(Math.log2(segs.length)), segX2 - searchRange),
    u16(...segs.map((s) => s.end)), u16(0), u16(...segs.map((s) => s.start)), u16(...segs.map((s) => s.delta)), u16(...segs.map(() => 0)),
  ]);
  sub.writeUInt16BE(sub.length, 2);
  const cmap = Buffer.concat([u16(0, 1), u16(3, 1), u32(12), sub]);
  // name: Windows, US English, UTF-16BE.
  const names = [
    [0, 'Froggion'], [1, 'Froggion Pixel Extra'], [2, 'Regular'], [3, 'Froggion Pixel Extra 1.0'],
    [4, 'Froggion Pixel Extra'], [5, 'Version 1.000'], [6, 'FroggionPixelExtra-Regular'],
  ].map(([id, s]) => [id, Buffer.from(s, 'utf16le').swap16()]);
  let strOffset = 0;
  const records = names.map(([id, s]) => { const r = u16(3, 1, 0x409, id, s.length, strOffset); strOffset += s.length; return r; });
  const name = Buffer.concat([u16(0, names.length, 6 + names.length * 12), ...records, ...names.map(([, s]) => s)]);
  const post = Buffer.concat([u32(0x00030000), u32(0), i16(-128), i16(128), u32(0), u32(0), u32(0), u32(0), u32(0)]);

  const tables = new Map(Object.entries({ 'OS/2': os2, cmap, glyf, head, hhea, hmtx, loca, maxp, name, post }));
  return { flavor: 0x00010000, tables };
}

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/^handjet-/.test(f) || f === 'OFL.txt') fs.rmSync(path.join(OUT, f));
fs.writeFileSync(path.join(OUT, 'pixel.woff'), writeWoff(readSfnt(fs.readFileSync(path.join(SRC, 'Minecraft_1.1.ttf')))));
fs.writeFileSync(path.join(OUT, 'pixel-extra.woff'), writeWoff(buildExtraFont()));
fs.writeFileSync(path.join(OUT, 'LICENSE.txt'), `pixel.woff — «Minecraft 1.1» by Pwnage_Block, ${fs.readFileSync(path.join(SRC, 'COPYRIGHT.txt'), 'utf8').trim()}.
https://fontstruct.com/fontstructions/show/432966
Licensed under Creative Commons Attribution-ShareAlike 3.0: https://creativecommons.org/licenses/by-sa/3.0/
Repacked from TrueType to WOFF without changes to the glyphs or the names.

pixel-extra.woff — signs missing from that font (₽ — – − « » → × … · ©), drawn for Froggion in the same pixel grid.
`);
console.log(fs.readdirSync(OUT).map((f) => `${f}: ${(fs.statSync(path.join(OUT, f)).size / 1024).toFixed(1)} KB`).join('\n'));
