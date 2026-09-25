// Reading and writing Replay Mod .mcpr files (ZIP with metaData.json + recording.tmcpr).
import JSZip from 'jszip';
import mc from 'minecraft-protocol';

const { createDeserializer, createSerializer, states } = mc;

export const VERSION = '1.16.5';

export async function readMcpr(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const metaFile = zip.file('metaData.json');
  const recFile = zip.file('recording.tmcpr');
  if (!metaFile || !recFile) throw new Error('not an mcpr: metaData.json or recording.tmcpr missing');
  const meta = JSON.parse(await metaFile.async('string'));
  const version = meta.mcversion || VERSION;
  const packets = parseTmcpr(await recFile.async('nodebuffer'), version);
  return { meta, packets };
}

// Records are [int32 BE time ms][int32 BE length][packet]; clientbound, starting in the login state.
export function parseTmcpr(buf, version = VERSION) {
  let state = states.LOGIN;
  let des = createDeserializer({ state, isServer: false, version, noErrorLogging: true });
  const packets = [];
  let off = 0;
  while (off + 8 <= buf.length) {
    const t = buf.readInt32BE(off);
    const len = buf.readInt32BE(off + 4);
    const body = buf.subarray(off + 8, off + 8 + len);
    off += 8 + len;
    const { name, params } = des.parsePacketBuffer(body).data;
    packets.push({ t, state, name, params });
    if (state === states.LOGIN && name === 'success') {
      state = states.PLAY;
      des = createDeserializer({ state, isServer: false, version, noErrorLogging: true });
    }
  }
  return packets;
}

// Inverse of parseTmcpr, used to build test fixtures. Packets before `success` are login packets.
export function encodeTmcpr(packets, version = VERSION) {
  let state = states.LOGIN;
  let ser = createSerializer({ state, isServer: true, version });
  const chunks = [];
  for (const { t, name, params } of packets) {
    const body = ser.createPacketBuffer({ name, params });
    const head = Buffer.alloc(8);
    head.writeInt32BE(t, 0);
    head.writeInt32BE(body.length, 4);
    chunks.push(head, body);
    if (state === states.LOGIN && name === 'success') {
      state = states.PLAY;
      ser = createSerializer({ state, isServer: true, version });
    }
  }
  return Buffer.concat(chunks);
}

export async function writeMcpr(meta, tmcpr) {
  const zip = new JSZip();
  zip.file('metaData.json', JSON.stringify(meta));
  zip.file('recording.tmcpr', tmcpr);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
