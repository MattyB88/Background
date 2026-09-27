// Minecraft AI Buddies - local control panel.
// Serves the UI on http://localhost:8765, stores settings, and runs the Minecraft server + Mindcraft.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, exec } from 'node:child_process';
import * as catalog from './catalog.js';
import { PROVIDERS, PRESETS, DEFAULT_MODES, SPEEDS, WORLDS, MC_VERSION, VOICE, DEFAULT_VOICES } from './catalog.js';
import { DATA, MINDCRAFT_DIR, ensureAll, writeServerFiles, serverLaunch, serverDir } from './setup.js';

const PORT = Number(process.env.PANEL_PORT) || 8765;
const UI_DIR = path.join(import.meta.dirname, 'ui');
const CONFIG_PATH = path.join(DATA, 'config.json');
const IS_WIN = process.platform === 'win32';

// ---------- config ----------
function defaultProfile(preset = PRESETS[0], name = 'Buddy') {
  return {
    id: crypto.randomUUID(), name, enabled: true, preset: preset.id, color: preset.color,
    provider: 'anthropic', model: PROVIDERS.anthropic.models[0], speed: 'fast',
    personality: preset.text, modes: { ...DEFAULT_MODES },
    voiceOn: false, voiceId: DEFAULT_VOICES[0].id,
  };
}

const DEFAULT_CONFIG = {
  setupDone: false,
  keys: {},
  players: [],
  world: 'buddy',
  difficulty: 'easy',
  gamemode: 'survival',
  memoryGB: 4,
  familyOnly: true,
  keepInventory: true,
  autoStart: true,
  profiles: [defaultProfile()],
};

fs.mkdirSync(DATA, { recursive: true });
let config = fs.existsSync(CONFIG_PATH)
  ? { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }
  : structuredClone(DEFAULT_CONFIG);
const saveConfig = () => fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

const mask = (k) => (k ? `••••${k.slice(-4)}` : '');
function publicConfig() {
  const keys = {};
  for (const [name, val] of Object.entries(config.keys)) if (val) keys[name] = mask(val);
  return { ...config, keys };
}

// ---------- events (SSE) ----------
const clients = new Set();
const logs = { server: [], buddies: [], setup: [] };
function emit(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(data);
}
function log(src, text) {
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    logs[src].push(line);
    if (logs[src].length > 800) logs[src].shift();
    emit({ type: 'log', src, line });
  }
}

// ---------- state ----------
const state = { phase: 'idle', progress: null, error: null, world: null, online: [] };
function setState(patch) {
  Object.assign(state, patch);
  emit({ type: 'state', state });
}

let serverProc = null;
let botsProc = null;

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

// ---------- Mindcraft profiles ----------
function buildConversing(p) {
  return `You are ${p.name}, an AI Minecraft player who is a real friend to the players - a parent and their kid. ${p.personality}
Keep every message short, friendly and kid-appropriate. Be genuinely useful: when someone asks for something, do it right away with commands. Never grief, never break things players built, never take from their chests unless asked.
When nobody needs you, give yourself a useful long-term goal that fits your personality with !goal, and check back in with the players now and then.
$SELF_PROMPT Don't pretend to act, use commands immediately when requested. Do NOT say 'Sure, I've stopped. *stops*', instead say 'Sure, I'll stop. !stop'. Respond only as $NAME, never output '(FROM OTHER BOT)' or pretend to be someone else. If you have nothing to say or do, respond with just a tab '\t'.
Summarized memory:'$MEMORY'
$STATS
$INVENTORY
$COMMAND_DOCS
$EXAMPLES
Conversation Begin:`;
}

function mindcraftProfile(p) {
  const model = { api: p.provider, model: p.model };
  const effort = SPEEDS[p.speed]?.effort;
  // Effort tunes how long Claude thinks before replying; Haiku doesn't take it.
  if (p.provider === 'anthropic' && effort && !p.model.includes('haiku')) {
    model.params = { output_config: { effort } };
  }
  const profile = { name: p.name, model, conversing: buildConversing(p), modes: { ...DEFAULT_MODES, ...p.modes } };
  // Examples are picked with embeddings; borrow a provider that has them when the chat one doesn't.
  if (!['openai', 'google', 'ollama'].includes(p.provider)) {
    if (config.keys.OPENAI_API_KEY) profile.embedding = 'openai';
    else if (config.keys.GEMINI_API_KEY) profile.embedding = 'google';
  }
  return profile;
}

function activeProfiles() {
  return config.profiles.filter((p) => p.enabled && (!PROVIDERS[p.provider].key || config.keys[PROVIDERS[p.provider].key]));
}

// ---------- voices (ElevenLabs) ----------
// The panel listens for AI friends' chat in the server log, turns it into speech and
// sends the audio to the browser, which plays it. Mindcraft itself isn't involved.
let voiceQueue = Promise.resolve();
function speakChat(name, text) {
  const key = config.keys[VOICE.key];
  const p = config.profiles.find((x) => x.name === name && x.voiceOn && x.voiceId);
  if (!key || !p || !clients.size) return;
  const clean = text.replace(/!\w+(\([^)]*\))?/g, '').replace(/\s+/g, ' ').trim().slice(0, 400);
  if (!/[a-z]/i.test(clean)) return;
  voiceQueue = voiceQueue.then(async () => {
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(p.voiceId)}?output_format=mp3_44100_64`, {
        method: 'POST', signal: AbortSignal.timeout(20000),
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: clean, model_id: VOICE.model }),
      });
      if (!res.ok) return log('buddies', `[voice] ElevenLabs said ${res.status}: ${(await res.text()).slice(0, 200)}`);
      emit({ type: 'voice', name, text: clean, audio: Buffer.from(await res.arrayBuffer()).toString('base64') });
    } catch (e) { log('buddies', `[voice] ${e.message}`); }
  });
}

async function listVoices() {
  const key = config.keys[VOICE.key];
  if (!key) return { voices: DEFAULT_VOICES, own: false };
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { voices: DEFAULT_VOICES, own: false };
    const data = await res.json();
    const labels = (v) => Object.values(v.labels || {}).filter(Boolean).slice(0, 2).join(', ');
    return { voices: data.voices.map((v) => ({ id: v.voice_id, name: labels(v) ? `${v.name} (${labels(v)})` : v.name })), own: true };
  } catch { return { voices: DEFAULT_VOICES, own: false }; }
}

// ---------- whitelist / ops ----------
// In offline mode the server identifies players by an "offline UUID" derived from their name.
// `whitelist add` would store the Mojang account UUID instead (e.g. a real account called "Buddy"),
// which then doesn't match and gets everyone kicked - so we write both lists ourselves.
function offlineUUID(name) {
  const h = crypto.createHash('md5').update(`OfflinePlayer:${name}`).digest();
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

function writeAccessLists(world) {
  const dir = serverDir(world);
  const names = [...new Set([...config.players, ...config.profiles.map((p) => p.name)])];
  fs.writeFileSync(path.join(dir, 'whitelist.json'),
    JSON.stringify(names.map((name) => ({ uuid: offlineUUID(name), name })), null, 2));
  fs.writeFileSync(path.join(dir, 'ops.json'), JSON.stringify(config.players.map((name) => (
    { uuid: offlineUUID(name), name, level: 4, bypassesPlayerLimit: false })), null, 2));
}

// ---------- start / stop ----------
function sendServer(cmd) {
  if (serverProc?.stdin.writable) {
    serverProc.stdin.write(cmd + '\n');
    log('server', `> ${cmd}`);
  }
}

async function start() {
  if (state.phase !== 'idle' && state.phase !== 'error') return;
  const world = config.world;
  setState({ phase: 'installing', error: null, world, progress: { label: 'Getting ready…', pct: null } });
  try {
    await ensureAll(world, { progress: (p) => setState({ progress: p }), log: (t) => log('setup', t) });
  } catch (err) {
    log('setup', `ERROR: ${err.stack || err}`);
    return setState({ phase: 'error', error: `Setup failed: ${err.message}` });
  }

  writeServerFiles(world, config);
  writeAccessLists(world);
  const { cmd, args, cwd } = serverLaunch(world, config);
  setState({ phase: 'starting', progress: { label: 'Starting Minecraft server…', pct: null } });
  serverProc = spawn(cmd, args, { cwd, windowsHide: true });
  const onOut = (d) => {
    const text = d.toString();
    log('server', text);
    if (state.phase === 'starting' && /Done \([\d.,]+s\)!/.test(text)) onServerReady(world);
    for (const m of text.matchAll(/INFO\]: (?:\[Not Secure\] )?<(\w+)> (.+)/g)) speakChat(m[1], m[2]);
    const join = text.match(/: (\w+) joined the game/);
    if (join) setState({ online: [...new Set([...state.online, join[1]])] });
    const denied = text.match(/Disconnecting (\w+) \(.*not white-listed/);
    if (denied) emit({ type: 'denied', name: denied[1] });
    const left = text.match(/: (\w+) left the game/);
    if (left) setState({ online: state.online.filter((n) => n !== left[1]) });
  };
  serverProc.stdout.on('data', onOut);
  serverProc.stderr.on('data', onOut);
  serverProc.on('close', (code) => {
    serverProc = null;
    stopBots();
    const crashed = state.phase !== 'stopping';
    setState({ phase: crashed ? 'error' : 'idle', online: [], progress: null,
      error: crashed ? `Minecraft server stopped unexpectedly (code ${code}). Check the Server log.` : null });
  });
}

function onServerReady(world) {
  const bots = WORLDS[world].ai ? activeProfiles() : [];
  sendServer(`gamerule keepInventory ${config.keepInventory}`);
  setState({ phase: 'running', progress: null });
  if (bots.length) startBots(bots);
  else if (WORLDS[world].ai) log('buddies', 'No AI friends enabled (or missing API keys) - add one on the AI Friends tab.');
}

function startBots(bots) {
  const dir = path.join(DATA, 'profiles');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const files = bots.map((b) => {
    const file = path.join(dir, `${b.name.replace(/[^\w-]/g, '_')}.json`);
    fs.writeFileSync(file, JSON.stringify(mindcraftProfile(b), null, 2));
    return file;
  });
  const keys = Object.fromEntries(Object.entries(config.keys).filter(([, v]) => v));
  fs.writeFileSync(path.join(MINDCRAFT_DIR, 'keys.json'), JSON.stringify(keys, null, 2));
  const settings = {
    minecraft_version: MC_VERSION, host: '127.0.0.1', port: 25565, auth: 'offline',
    mindserver_port: 8080, auto_open_ui: false, base_profile: 'assistant', profiles: files,
    load_memory: true, only_chat_with: [], chat_ingame: true, allow_insecure_coding: false,
    // Keep code-writing actions out of the prompt so the model sticks to the built-in commands.
    blocked_actions: ["!newAction", "!checkBlueprint", "!checkBlueprintLevel", "!getBlueprint", "!getBlueprintLevel"],
    narrate_behavior: true, chat_bot_messages: true,
    init_message: 'You just joined the world. Say a short hello to the players, then go to the nearest player and ask what they are up to. If nobody answers, set yourself a useful goal with !goal.',
  };
  log('buddies', `Starting AI friends: ${bots.map((b) => b.name).join(', ')}`);
  botsProc = spawn(process.execPath, ['main.js'], {
    cwd: MINDCRAFT_DIR, windowsHide: true, env: { ...process.env, SETTINGS_JSON: JSON.stringify(settings) },
  });
  botsProc.stdout.on('data', (d) => log('buddies', d));
  botsProc.stderr.on('data', (d) => log('buddies', d));
  botsProc.on('close', (code) => { log('buddies', `AI friends stopped (code ${code}).`); botsProc = null; emit({ type: 'state', state }); });
}

function stopBots() {
  if (!botsProc) return;
  const pid = botsProc.pid;
  if (IS_WIN) exec(`taskkill /pid ${pid} /T /F`);
  else botsProc.kill('SIGTERM');
}

function stop() {
  if (!serverProc) return setState({ phase: 'idle', error: null });
  setState({ phase: 'stopping' });
  stopBots();
  sendServer('stop');
  setTimeout(() => serverProc?.kill(), 45000);
}

function restartBots() {
  if (state.phase !== 'running' || !WORLDS[state.world].ai) return;
  stopBots();
  setTimeout(() => {
    const bots = activeProfiles();
    writeAccessLists(state.world);
    sendServer('whitelist reload');
    if (bots.length) startBots(bots);
  }, 2500);
}

// ---------- key testing ----------
async function testKey(provider, key) {
  const H = (h) => ({ headers: h, signal: AbortSignal.timeout(15000) });
  const bearer = (url) => fetch(url, H({ Authorization: `Bearer ${key}` }));
  const urls = {
    openai: 'https://api.openai.com/v1/models', xai: 'https://api.x.ai/v1/models',
    deepseek: 'https://api.deepseek.com/models', mistral: 'https://api.mistral.ai/v1/models',
    groq: 'https://api.groq.com/openai/v1/models', openrouter: 'https://openrouter.ai/api/v1/key',
  };
  let res;
  if (provider === 'elevenlabs') {
    res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${DEFAULT_VOICES[0].id}?output_format=mp3_22050_32`, {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hi!', model_id: VOICE.model }),
    });
    if (res.ok) return { ok: true, msg: 'Key works - voices are ready!' };
    return { ok: false, msg: res.status === 401 ? 'Rejected. Check the key, and that it has Access to Text to Speech.' : `ElevenLabs said ${res.status}.` };
  }
  if (provider === 'anthropic') {
    res = await fetch('https://api.anthropic.com/v1/models', H({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }));
  } else if (provider === 'google') {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`, H({}));
  } else if (urls[provider]) {
    res = await bearer(urls[provider]);
  } else return { ok: true, msg: 'Saved (no test available for this provider).' };
  if (res.ok) return { ok: true, msg: 'Key works!' };
  return { ok: false, msg: res.status === 401 || res.status === 403 ? 'That key was rejected - double-check it.' : `Provider said ${res.status}.` };
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

async function readBody(req) {
  let s = '';
  for await (const c of req) s += c;
  return s ? JSON.parse(s) : {};
}

function openFolder(p) {
  fs.mkdirSync(p, { recursive: true });
  const cmd = IS_WIN ? `explorer "${p}"` : process.platform === 'darwin' ? `open "${p}"` : `xdg-open "${p}"`;
  exec(cmd);
}

const routes = {
  'GET /api/bootstrap': () => ({
    config: publicConfig(), state, logs, lan: lanAddresses(), botsRunning: !!botsProc,
    catalog: { VOICE, PROVIDERS, PRESETS, MODES: catalog.MODES, SPEEDS, WORLDS, MC_VERSION, NEOFORGE_VERSION: catalog.NEOFORGE_VERSION },
  }),
  'POST /api/settings': (b) => {
    const allowed = ['players', 'world', 'difficulty', 'gamemode', 'memoryGB', 'familyOnly', 'keepInventory', 'autoStart', 'setupDone'];
    for (const k of allowed) if (k in b) config[k] = b[k];
    if (b.players) config.players = b.players.map((s) => s.trim()).filter(Boolean);
    saveConfig();
    return { config: publicConfig() };
  },
  'POST /api/keys': (b) => {
    for (const [name, val] of Object.entries(b.keys || {})) {
      if (name !== VOICE.key && !Object.values(PROVIDERS).some((p) => p.key === name)) continue;
      config.keys[name] = String(val || '').trim();
    }
    saveConfig();
    return { config: publicConfig() };
  },
  'POST /api/keys/test': async (b) => {
    const prov = b.provider === 'elevenlabs' ? VOICE : PROVIDERS[b.provider];
    const key = (b.key || '').trim() || config.keys[prov?.key];
    if (!prov || (prov.key && !key)) return { ok: false, msg: 'Paste a key first.' };
    try { return await testKey(b.provider, key); } catch (e) { return { ok: false, msg: `Couldn't reach the provider: ${e.message}` }; }
  },
  'POST /api/profiles': (b) => {
    const p = b.profile;
    if (!p?.name || !/^\w{3,16}$/.test(p.name)) throw new Error('Name must be 3-16 letters, numbers or _ (Minecraft rules).');
    if (!PROVIDERS[p.provider]) throw new Error('Unknown AI provider.');
    const clean = { ...defaultProfile(), ...p, modes: { ...DEFAULT_MODES, ...p.modes } };
    const clash = config.profiles.find((x) => x.name.toLowerCase() === clean.name.toLowerCase() && x.id !== clean.id);
    if (clash) throw new Error(`There's already a friend called ${clash.name}.`);
    const i = config.profiles.findIndex((x) => x.id === clean.id);
    if (i >= 0) config.profiles[i] = clean; else config.profiles.push(clean);
    saveConfig();
    restartBots();
    return { config: publicConfig() };
  },
  'POST /api/profiles/delete': (b) => {
    config.profiles = config.profiles.filter((p) => p.id !== b.id);
    saveConfig();
    restartBots();
    return { config: publicConfig() };
  },
  'GET /api/voices': () => listVoices(),
  'POST /api/speak-test': (b) => { speakChat(b.name, b.text || `Hi! I'm ${b.name}. Let's go on an adventure!`); return { ok: true }; },
  'POST /api/start': () => { start(); return { ok: true }; },
  'POST /api/stop': () => { stop(); return { ok: true }; },
  'POST /api/restart-bots': () => { restartBots(); return { ok: true }; },
  'POST /api/allow-player': (b) => {
    const name = String(b.name || '');
    if (!/^\w{3,16}$/.test(name)) throw new Error('Not a valid Minecraft name.');
    if (!config.players.includes(name)) config.players.push(name);
    saveConfig();
    writeAccessLists(state.world || config.world);
    sendServer('whitelist reload');
    return { config: publicConfig() };
  },
  'POST /api/command': (b) => {
    if (!serverProc) throw new Error('The server is not running.');
    sendServer(String(b.command || '').replace(/^\//, '').replace(/[\r\n]/g, ''));
    return { ok: true };
  },
  'POST /api/open': (b) => {
    const places = { world: serverDir(config.world), mods: path.join(serverDir(config.world), 'mods'), data: DATA };
    openFolder(places[b.what] || DATA);
    return { ok: true };
  },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // Only accept requests addressed to this machine, so other websites can't drive the panel.
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '')) { res.writeHead(403); return res.end(); }

  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ type: 'state', state })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  const route = routes[`${req.method} ${url.pathname}`];
  if (route) {
    if (req.method === 'POST' && req.headers['content-type'] !== 'application/json') { res.writeHead(415); return res.end(); }
    try {
      const out = await route(req.method === 'POST' ? await readBody(req) : {});
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  const file = path.join(UI_DIR, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
  if (!file.startsWith(UI_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`The panel is already running - opening it at http://localhost:${PORT}`);
    openBrowser();
    setTimeout(() => process.exit(0), 500);
  } else throw e;
});

function openBrowser() {
  if (process.env.NO_BROWSER) return;
  const url = `http://localhost:${PORT}`;
  exec(IS_WIN ? `start "" "${url}"` : process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`);
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Minecraft AI Buddies is running.\n  Control panel: http://localhost:${PORT}\n  Keep this window open while you play. Close it to shut everything down.\n`);
  openBrowser();
  if (config.setupDone && config.autoStart) start();
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('Saving the world and shutting down…');
  if (!serverProc) process.exit(0);
  stop();
  serverProc?.on('close', () => process.exit(0));
  setTimeout(() => process.exit(0), 50000);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);
