// Downloads and installs everything the first time: Java, the Minecraft server, mods and Mindcraft.
// Every step is idempotent, so running it again only fetches what's missing.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MC_VERSION, NEOFORGE_VERSION, MINDCRAFT_REF, WORLDS } from './catalog.js';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const DATA = path.join(ROOT, 'data');
export const RUNTIME = path.join(DATA, 'runtime');
export const MINDCRAFT_DIR = path.join(DATA, 'mindcraft');
export const serverDir = (world) => path.join(DATA, 'servers', world);

const IS_WIN = process.platform === 'win32';
const UA = { 'User-Agent': 'minecraft-ai-buddies/1.0 (family launcher)' };

async function getJSON(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function download(url, dest, progress, label) {
  const res = await fetch(url, { headers: UA, redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let done = 0;
  const tmp = dest + '.part';
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    done += chunk.length;
    progress?.({ label, pct: total ? Math.round((done / total) * 100) : null });
  });
  await pipeline(body, fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
}

export function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, ...opts });
    p.stdout?.on('data', (d) => opts.onLine?.(d.toString()));
    p.stderr?.on('data', (d) => opts.onLine?.(d.toString()));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited with code ${code}`))));
  });
}

// Windows 10+ ships bsdtar, which extracts .zip as well as .tar.gz.
async function extract(archive, destDir) {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  await run('tar', ['-xf', archive, '-C', destDir]);
  fs.rmSync(archive, { force: true });
  const entries = fs.readdirSync(destDir);
  return entries.length === 1 ? path.join(destDir, entries[0]) : destDir;
}

// ---------- Java ----------
export function javaBin() {
  const home = path.join(RUNTIME, 'java');
  const candidates = [
    path.join(home, 'bin', IS_WIN ? 'java.exe' : 'java'),
    path.join(home, 'Contents', 'Home', 'bin', 'java'),
  ];
  return candidates.find((c) => fs.existsSync(c));
}

async function ensureJava(progress) {
  if (javaBin()) return;
  const os = IS_WIN ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
  const url = `https://api.adoptium.net/v3/binary/latest/21/ga/${os}/${arch}/jre/hotspot/normal/eclipse`;
  const archive = path.join(RUNTIME, IS_WIN ? 'java.zip' : 'java.tar.gz');
  await download(url, archive, progress, 'Downloading Java 21');
  progress?.({ label: 'Unpacking Java', pct: null });
  const tmp = path.join(RUNTIME, 'java-tmp');
  const inner = await extract(archive, tmp);
  fs.rmSync(path.join(RUNTIME, 'java'), { recursive: true, force: true });
  fs.renameSync(inner, path.join(RUNTIME, 'java'));
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!javaBin()) throw new Error('Java was downloaded but java binary was not found.');
}

// ---------- Mods (Modrinth) ----------
async function ensureMods(world, loader, progress) {
  const modsDir = path.join(serverDir(world), 'mods');
  fs.mkdirSync(modsDir, { recursive: true });
  const manifestPath = path.join(modsDir, '.managed.json');
  const managed = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
  for (const entry of WORLDS[world].mods) {
    // "slug@version" pins an exact Modrinth version (needed when clients must match it).
    const [slug, pinned] = entry.split('@');
    if (managed[slug] && (!pinned || managed[slug].includes(pinned.replace(/^\w+-/, ''))) && fs.existsSync(path.join(modsDir, managed[slug]))) continue;
    if (managed[slug]) fs.rmSync(path.join(modsDir, managed[slug]), { force: true });
    progress?.({ label: `Finding mod: ${slug}`, pct: null });
    const q = new URLSearchParams({ loaders: JSON.stringify([loader]), game_versions: JSON.stringify([MC_VERSION]) });
    const versions = await getJSON(`https://api.modrinth.com/v2/project/${slug}/version?${q}`);
    const v = pinned ? versions.find((x) => x.version_number === pinned) : (versions.find((x) => x.version_type === 'release') || versions[0]);
    if (!v) throw new Error(`No ${loader} ${MC_VERSION} version of "${slug}" on Modrinth.`);
    const file = v.files.find((f) => f.primary) || v.files[0];
    await download(file.url, path.join(modsDir, file.filename), progress, `Downloading ${file.filename}`);
    managed[slug] = file.filename;
    fs.writeFileSync(manifestPath, JSON.stringify(managed, null, 2));
  }
}

// ---------- Minecraft servers ----------
async function ensureBuddyServer(progress) {
  const dir = serverDir('buddy');
  const jar = path.join(dir, 'server.jar');
  if (!fs.existsSync(jar)) {
    progress?.({ label: 'Finding the latest Fabric server', pct: null });
    const loaders = await getJSON(`https://meta.fabricmc.net/v2/versions/loader/${MC_VERSION}`);
    const loader = (loaders.find((l) => l.loader.stable) || loaders[0]).loader.version;
    const installers = await getJSON('https://meta.fabricmc.net/v2/versions/installer');
    const installer = (installers.find((i) => i.stable) || installers[0]).version;
    await download(`https://meta.fabricmc.net/v2/versions/loader/${MC_VERSION}/${loader}/${installer}/server/jar`,
      jar, progress, 'Downloading Minecraft server (Fabric)');
  }
  await ensureMods('buddy', 'fabric', progress);
}

async function ensureMagicServer(progress, log) {
  const dir = serverDir('magic');
  const argsFile = path.join(dir, 'libraries', 'net', 'neoforged', 'neoforge', NEOFORGE_VERSION, IS_WIN ? 'win_args.txt' : 'unix_args.txt');
  if (!fs.existsSync(argsFile)) {
    const installer = path.join(dir, 'neoforge-installer.jar');
    await download(`https://maven.neoforged.net/releases/net/neoforged/neoforge/${NEOFORGE_VERSION}/neoforge-${NEOFORGE_VERSION}-installer.jar`,
      installer, progress, `Downloading NeoForge ${NEOFORGE_VERSION}`);
    progress?.({ label: 'Installing NeoForge server (takes a minute)', pct: null });
    await run(javaBin(), ['-jar', installer, '--installServer', dir], { cwd: dir, onLine: log });
    fs.rmSync(installer, { force: true });
  }
  await ensureMods('magic', 'neoforge', progress);
}

// ---------- Mindcraft ----------
function npmCli() {
  const nodeDir = path.dirname(process.execPath);
  const candidates = [
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  return candidates.find((c) => fs.existsSync(c));
}

export function mindcraftReady() {
  return fs.existsSync(path.join(MINDCRAFT_DIR, `.installed-${MINDCRAFT_REF}`));
}

function npmRunner() {
  const cli = npmCli();
  const nodeDir = path.dirname(process.execPath);
  const env = { ...process.env, PATH: nodeDir + path.delimiter + process.env.PATH };
  const [cmd, base] = cli ? [process.execPath, [cli]] : [IS_WIN ? 'npm.cmd' : 'npm', []];
  return (args, log) => run(cmd, [...base, ...args], { cwd: MINDCRAFT_DIR, env, onLine: log, shell: !cli && IS_WIN });
}

// In-game voice add-on: needs the pure-JS Opus codec, plus our module wired into Mindcraft.
const VOICE_ADDON_VERSION = 1;
async function ensureVoiceAddon(progress, log) {
  const marker = path.join(MINDCRAFT_DIR, `.voice-addon-${VOICE_ADDON_VERSION}`);
  if (!fs.existsSync(marker)) {
    progress?.({ label: 'Installing the voice add-on', pct: null });
    await npmRunner()(['install', 'opusscript@0.1.1', '--no-save', '--no-audit', '--no-fund'], log);
    fs.writeFileSync(marker, new Date().toISOString());
  }
  installVoiceFiles();
}

export function installVoiceFiles() {
  const agentDir = path.join(MINDCRAFT_DIR, 'src', 'agent');
  fs.copyFileSync(path.join(import.meta.dirname, 'mindcraft-addons', 'ingame_voice.js'), path.join(agentDir, 'ingame_voice.js'));
  // Mindcraft calls speak() for every chat line when settings.speak is on; route it into voice chat.
  fs.writeFileSync(path.join(agentDir, 'speak.js'),
    '// Replaced by AI Buddies: speech goes into Simple Voice Chat (see ingame_voice.js).\n' +
    'export function speak(text) { globalThis.__ingameVoice?.say(text); }\n');
  const agentFile = path.join(agentDir, 'agent.js');
  const src = fs.readFileSync(agentFile, 'utf8');
  const anchor = 'this.bot = initBot(this.name);';
  if (!src.includes('ingame_voice.js') && src.includes(anchor)) {
    fs.writeFileSync(agentFile, src.replace(anchor,
      `${anchor}\n        import('./ingame_voice.js').then((m) => m.attach(this)).catch((e) => console.error('[voice] failed to start:', e));`));
  }
}

async function ensureMindcraft(progress, log) {
  if (mindcraftReady()) return ensureVoiceAddon(progress, log);
  if (!fs.existsSync(path.join(MINDCRAFT_DIR, 'main.js'))) {
    const archive = path.join(DATA, 'mindcraft.tar.gz');
    await download(`https://github.com/mindcraft-bots/mindcraft/archive/${MINDCRAFT_REF}.tar.gz`,
      archive, progress, 'Downloading Mindcraft (the AI brain)');
    const tmp = path.join(DATA, 'mindcraft-tmp');
    const inner = await extract(archive, tmp);
    fs.renameSync(inner, MINDCRAFT_DIR);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  progress?.({ label: 'Installing Mindcraft packages (a few minutes the first time)', pct: null });
  await npmRunner()(['install', '--no-audit', '--no-fund'], log);
  fs.writeFileSync(path.join(MINDCRAFT_DIR, `.installed-${MINDCRAFT_REF}`), new Date().toISOString());
  await ensureVoiceAddon(progress, log);
}

export async function ensureAll(world, { progress, log }) {
  fs.mkdirSync(RUNTIME, { recursive: true });
  await ensureJava(progress);
  if (world === 'magic') await ensureMagicServer(progress, log);
  else await ensureBuddyServer(progress);
  if (WORLDS[world].ai) await ensureMindcraft(progress, log);
  progress?.({ label: 'Ready', pct: 100 });
}

// ---------- server.properties ----------
export function writeServerFiles(world, cfg) {
  const dir = serverDir(world);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'eula.txt'), 'eula=true\n');
  const propsPath = path.join(dir, 'server.properties');
  const props = {};
  if (fs.existsSync(propsPath)) {
    for (const line of fs.readFileSync(propsPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) props[m[1].trim()] = m[2];
    }
  }
  Object.assign(props, {
    'server-port': '25565',
    motd: world === 'magic' ? '§dMagic World §7- Ars Nouveau' : '§aBuddy World §7- play with AI friends!',
    difficulty: cfg.difficulty,
    gamemode: cfg.gamemode,
    // Mindcraft bots log in without Microsoft accounts, so the server must accept offline logins.
    // The family-only whitelist keeps strangers out; don't port-forward the server anyway.
    'online-mode': 'false',
    'enforce-secure-profile': 'false',
    'white-list': String(cfg.familyOnly),
    'enforce-whitelist': String(cfg.familyOnly),
    'spawn-protection': '0',
    'view-distance': '10',
    'allow-flight': 'true',
  });
  fs.writeFileSync(propsPath, Object.entries(props).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  if (world === 'magic') {
    fs.writeFileSync(path.join(dir, 'user_jvm_args.txt'), `-Xms1G\n-Xmx${cfg.memoryGB}G\n`);
  }
}

export function serverLaunch(world, cfg) {
  const dir = serverDir(world);
  if (world === 'magic') {
    const rel = path.join('libraries', 'net', 'neoforged', 'neoforge', NEOFORGE_VERSION, IS_WIN ? 'win_args.txt' : 'unix_args.txt');
    return { cmd: javaBin(), args: ['@user_jvm_args.txt', `@${rel}`, 'nogui'], cwd: dir };
  }
  return { cmd: javaBin(), args: [`-Xms1G`, `-Xmx${cfg.memoryGB}G`, '-jar', 'server.jar', 'nogui'], cwd: dir };
}
