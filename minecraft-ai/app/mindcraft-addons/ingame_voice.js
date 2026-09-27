// In-game voice for Mindcraft bots via Simple Voice Chat (compatibility version 20, SVC 2.6.x).
// Installed into data/mindcraft/src/agent by the AI Buddies launcher.
//
// Speaking: chat text -> ElevenLabs TTS (PCM) -> Opus -> SVC mic packets, so players hear the bot
//           from its body in the world, like any other player on voice chat.
// Hearing:  SVC sound packets from nearby players -> Opus decode -> ElevenLabs speech-to-text
//           -> handed to the agent exactly like a chat message from that player.
//
// Protocol reference: github.com/henkelmax/simple-voice-chat (branch 1.21.1), classes SecretPacket,
// NetworkMessage, Secret (AES-GCM), MicPacket, PlayerSoundPacket, AuthenticatePacket.
import dgram from 'node:dgram';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import OpusScript from 'opusscript';

const COMPATIBILITY_VERSION = 20;
const SAMPLE_RATE = 48000;
const FRAME = 960; // 20 ms at 48 kHz
const MAGIC = 0xff;
const ID = { MIC: 1, PLAYER_SOUND: 2, GROUP_SOUND: 3, LOCATION_SOUND: 4, AUTH: 5, AUTH_ACK: 6, PING: 7, KEEP_ALIVE: 8, CHECK: 9, CHECK_ACK: 10 };
const log = (...a) => console.log('[voice]', ...a);

// ---------- tiny binary helpers (Minecraft FriendlyByteBuf encoding) ----------
class Writer {
  constructor() { this.parts = []; }
  u8(v) { this.parts.push(Buffer.from([v & 0xff])); return this; }
  bool(v) { return this.u8(v ? 1 : 0); }
  int(v) { const b = Buffer.alloc(4); b.writeInt32BE(v); this.parts.push(b); return this; }
  long(v) { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(v)); this.parts.push(b); return this; }
  raw(buf) { this.parts.push(buf); return this; }
  varint(v) {
    const out = [];
    do { let byte = v & 0x7f; v >>>= 7; if (v) byte |= 0x80; out.push(byte); } while (v);
    return this.raw(Buffer.from(out));
  }
  bytes(buf) { return this.varint(buf.length).raw(buf); }
  build() { return Buffer.concat(this.parts); }
}

class Reader {
  constructor(buf) { this.buf = buf; this.o = 0; }
  u8() { return this.buf[this.o++]; }
  bool() { return this.u8() !== 0; }
  int() { const v = this.buf.readInt32BE(this.o); this.o += 4; return v; }
  long() { const v = this.buf.readBigInt64BE(this.o); this.o += 8; return v; }
  float() { const v = this.buf.readFloatBE(this.o); this.o += 4; return v; }
  double() { const v = this.buf.readDoubleBE(this.o); this.o += 8; return v; }
  raw(n) { const v = this.buf.subarray(this.o, this.o + n); this.o += n; return v; }
  varint() {
    let v = 0, shift = 0, b;
    do { b = this.u8(); v |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
    return v;
  }
  bytes() { return this.raw(this.varint()); }
  uuid() { return uuidToString(this.raw(16)); }
  string() { return this.bytes().toString('utf8'); }
}

const uuidToBytes = (u) => Buffer.from(u.replace(/-/g, ''), 'hex');
const uuidToString = (b) => {
  const h = Buffer.from(b).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

// ---------- AES-GCM, 12 byte IV, tag appended (matches Java's AES/GCM/NoPadding) ----------
function encrypt(key, data) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-128-gcm', key, iv);
  return Buffer.concat([iv, c.update(data), c.final(), c.getAuthTag()]);
}
function decrypt(key, payload) {
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(payload.length - 16);
  const d = crypto.createDecipheriv('aes-128-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(payload.subarray(12, payload.length - 16)), d.final()]);
}

function readKeys() {
  try { return JSON.parse(readFileSync('./keys.json', 'utf8')); } catch { return {}; }
}

// ---------- audio helpers ----------
// ElevenLabs returns 24 kHz mono PCM on every plan; upsample 2x to Opus's 48 kHz.
function upsample24to48(pcm) {
  const n = pcm.length / 2;
  const out = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const a = pcm.readInt16LE(i * 2);
    const b = i + 1 < n ? pcm.readInt16LE(i * 2 + 2) : a;
    out.writeInt16LE(a, i * 4);
    out.writeInt16LE((a + b) >> 1, i * 4 + 2);
  }
  return out;
}

function wav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

function rms(pcm) {
  let sum = 0;
  const n = pcm.length / 2;
  for (let i = 0; i < n; i++) { const s = pcm.readInt16LE(i * 2); sum += s * s; }
  return Math.sqrt(sum / Math.max(1, n));
}

// ---------- the voice client ----------
class VoiceClient {
  constructor(agent, cfg) {
    this.agent = agent;
    this.bot = agent.bot;
    this.cfg = cfg;
    this.key = readKeys().ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY;
    this.encoder = new OpusScript(SAMPLE_RATE, 1, OpusScript.Application.VOIP);
    this.decoders = new Map();   // sender uuid -> OpusScript decoder
    this.utterances = new Map(); // sender uuid -> { chunks, last, timer }
    this.sequence = 0n;
    this.speakQueue = Promise.resolve();
    this.connected = false;
  }

  start() {
    const client = this.bot._client;
    client.on('custom_payload', (p) => {
      if (p.channel === 'voicechat:secret') this.onSecret(p.data);
    });
    const request = () => {
      try {
        client.write('custom_payload', { channel: 'minecraft:register', data: Buffer.from(['voicechat:secret', 'voicechat:player_state', 'voicechat:player_states'].join('\0')) });
        client.write('custom_payload', { channel: 'voicechat:request_secret', data: new Writer().int(COMPATIBILITY_VERSION).build() });
      } catch (e) { log('could not request voice secret:', e.message); }
    };
    this.bot.once('spawn', () => setTimeout(request, 1500));
    this.bot.on('end', () => this.stop());
  }

  stop() {
    clearInterval(this.keepAliveTimer);
    try { this.socket?.close(); } catch {}
    this.socket = null;
    this.connected = false;
  }

  onSecret(data) {
    const r = new Reader(data);
    this.secret = r.raw(16);
    const port = r.int();
    this.playerUUID = r.uuid();
    r.u8(); // codec
    r.int(); // mtu
    this.distance = r.double();
    r.int(); // keep-alive interval
    r.bool(); // groups enabled
    const voiceHost = r.string();
    this.host = this.bot._client.socket?.remoteAddress || '127.0.0.1';
    this.port = port;
    if (voiceHost) {
      try { const u = new URL('voicechat://' + voiceHost); if (u.hostname) this.host = u.hostname; if (u.port) this.port = Number(u.port); } catch {}
    }
    if (this.port < 0) this.port = this.bot._client.socket?.remotePort || 25565;
    log(`secret received, connecting to ${this.host}:${this.port}`);

    this.stop();
    this.socket = dgram.createSocket('udp4');
    this.socket.on('message', (msg) => this.onUdp(msg));
    this.socket.on('error', (e) => log('udp error', e.message));
    this.send(new Writer().u8(ID.AUTH).raw(uuidToBytes(this.playerUUID)).raw(this.secret).build());
    this.authRetry = setInterval(() => {
      if (this.connected) return clearInterval(this.authRetry);
      this.send(new Writer().u8(ID.AUTH).raw(uuidToBytes(this.playerUUID)).raw(this.secret).build());
    }, 2000);
  }

  send(payload) {
    if (!this.socket) return;
    const msg = new Writer().u8(MAGIC).raw(uuidToBytes(this.playerUUID)).bytes(encrypt(this.secret, payload)).build();
    this.socket.send(msg, this.port, this.host);
  }

  onUdp(msg) {
    let payload;
    try {
      const r = new Reader(msg);
      if (r.u8() !== MAGIC) return;
      payload = decrypt(this.secret, r.bytes());
    } catch { return; }
    const r = new Reader(payload);
    const id = r.u8();
    if (id === ID.AUTH_ACK) this.send(Buffer.from([ID.CHECK]));
    else if (id === ID.CHECK_ACK) {
      if (!this.connected) {
        this.connected = true;
        // Tell the server our voice chat is enabled, so it sends us other players' audio.
        this.bot._client.write('custom_payload', { channel: 'voicechat:update_state', data: new Writer().bool(false).build() });
        log('connected to Simple Voice Chat');
      }
    } else if (id === ID.PING) this.send(payload); // echo pings back unchanged
    else if (id === ID.KEEP_ALIVE) this.send(Buffer.from([ID.KEEP_ALIVE]));
    else if (id === ID.PLAYER_SOUND || id === ID.GROUP_SOUND || id === ID.LOCATION_SOUND) {
      r.uuid(); // channel id
      const sender = r.uuid();
      if (id === ID.LOCATION_SOUND) { r.double(); r.double(); r.double(); }
      const opus = r.bytes();
      this.onSound(sender, opus);
    }
  }

  // ---------- hearing ----------
  playerByUUID(uuid) {
    return Object.values(this.bot.players).find((p) => p.uuid === uuid);
  }

  onSound(sender, opus) {
    if (!this.cfg.listen || !this.key) return;
    let u = this.utterances.get(sender);
    if (!u) { u = { chunks: [], bytes: 0 }; this.utterances.set(sender, u); }
    if (opus.length) {
      let dec = this.decoders.get(sender);
      if (!dec) { dec = new OpusScript(SAMPLE_RATE, 1, OpusScript.Application.VOIP); this.decoders.set(sender, dec); }
      try {
        const pcm = Buffer.from(dec.decode(opus));
        if (u.bytes < SAMPLE_RATE * 2 * 30) { u.chunks.push(pcm); u.bytes += pcm.length; } // cap at 30 s
      } catch {}
    }
    clearTimeout(u.timer);
    // An empty packet means they let go of push-to-talk; otherwise wait for a short silence.
    u.timer = setTimeout(() => this.finishUtterance(sender), opus.length ? 800 : 50);
  }

  async finishUtterance(sender) {
    const u = this.utterances.get(sender);
    this.utterances.delete(sender);
    if (!u || u.bytes < SAMPLE_RATE * 2 * 0.4) return; // under 0.4 s: a cough or a click
    const pcm = Buffer.concat(u.chunks);
    if (rms(pcm) < 250) return; // basically silence
    const player = this.playerByUUID(sender);
    if (!player || player.username === this.bot.username) return;
    try {
      const form = new FormData();
      form.append('model_id', 'scribe_v1');
      form.append('file', new Blob([wav(pcm, SAMPLE_RATE)], { type: 'audio/wav' }), 'speech.wav');
      const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST', headers: { 'xi-api-key': this.key }, body: form, signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) return log(`speech-to-text failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
      const text = ((await res.json()).text || '').replace(/\([^)]*\)/g, '').trim(); // drop "(laughs)" style tags
      if (!text || !/[a-z]/i.test(text)) return;
      log(`heard ${player.username}: ${text}`);
      if (!this.shouldRespond(text)) return;
      this.agent.handleMessage(player.username, `(said out loud on voice chat) ${text}`);
    } catch (e) { log('speech-to-text error:', e.message); }
  }

  // With several players talking to each other, only jump in when addressed by name.
  shouldRespond(text) {
    if (this.cfg.hearAll) return true;
    const humans = Object.values(this.bot.players).filter((p) => p.username !== this.bot.username && !this.cfg.otherBots.includes(p.username));
    if (humans.length <= 1) return true;
    const name = this.bot.username.toLowerCase();
    const said = text.toLowerCase();
    return said.includes(name) || said.includes(name.slice(0, Math.max(3, name.length - 1)));
  }

  // ---------- speaking ----------
  say(text) {
    const clean = String(text).replace(/!\w+(\([^)]*\))?/g, '').replace(/\s+/g, ' ').trim().slice(0, 500);
    if (!clean || !/[a-z0-9]/i.test(clean) || !this.key || !this.cfg.voiceId) return;
    this.speakQueue = this.speakQueue.then(() => this.speakNow(clean)).catch((e) => log('speak error:', e.message));
  }

  async speakNow(text) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(this.cfg.voiceId)}?output_format=pcm_24000`, {
      method: 'POST', signal: AbortSignal.timeout(30000),
      headers: { 'xi-api-key': this.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: this.cfg.ttsModel || 'eleven_flash_v2_5' }),
    });
    if (!res.ok) return log(`text-to-speech failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const pcm = upsample24to48(Buffer.from(await res.arrayBuffer()));
    if (!this.connected) return log('not connected to voice chat yet - is Simple Voice Chat installed on the server?');
    const frameBytes = FRAME * 2;
    const frames = [];
    for (let o = 0; o < pcm.length; o += frameBytes) {
      let f = pcm.subarray(o, o + frameBytes);
      if (f.length < frameBytes) f = Buffer.concat([f, Buffer.alloc(frameBytes - f.length)]);
      frames.push(Buffer.from(this.encoder.encode(f, FRAME)));
    }
    // Pace frames in real time (20 ms each), like a real microphone.
    const start = Date.now();
    for (let i = 0; i < frames.length; i++) {
      this.sendMic(frames[i]);
      const wait = start + (i + 1) * 20 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    this.sendMic(Buffer.alloc(0)); // end of speech
  }

  sendMic(opus) {
    this.send(new Writer().u8(ID.MIC).bytes(opus).long(this.sequence++).bool(false).build());
  }
}

export function attach(agent) {
  const cfg = agent.prompter?.profile?.ingame_voice;
  if (!cfg || (!cfg.speak && !cfg.listen)) return;
  const voice = new VoiceClient(agent, cfg);
  voice.start();
  globalThis.__ingameVoice = cfg.speak ? voice : null;
  log(`in-game voice ready for ${agent.name} (speak: ${!!cfg.speak}, listen: ${!!cfg.listen})`);
}
