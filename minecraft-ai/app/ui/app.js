const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let C = null;        // catalog
let config = null;
let state = {};
let lan = [];
let logs = { server: [], buddies: [], setup: [] };
let logTab = 'server';

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  if (data.config) { config = data.config; if (C) renderAll(); }
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.add('hidden'), 2600);
}

// ---------- pixel faces ----------
function hash(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
function drawFace(canvas, name, color) {
  const g = canvas.getContext('2d');
  let h = hash(name || '?');
  const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) % 1000) / 1000;
  const shade = (hex, f) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
    return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
  };
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    g.fillStyle = shade(color, 0.8 + rnd() * 0.35);
    g.fillRect(x, y, 1, 1);
  }
  const hair = shade(color, 0.45);
  g.fillStyle = hair; g.fillRect(0, 0, 8, 2);
  if (rnd() > 0.5) { g.fillRect(0, 2, 1, 2); g.fillRect(7, 2, 1, 2); }
  g.fillStyle = '#fff'; g.fillRect(1, 4, 2, 1); g.fillRect(5, 4, 2, 1);
  g.fillStyle = '#222'; g.fillRect(rnd() > 0.5 ? 2 : 1, 4, 1, 1); g.fillRect(rnd() > 0.5 ? 6 : 5, 4, 1, 1);
  g.fillStyle = shade(color, 0.35); g.fillRect(3, 6, 2, 1);
  if (rnd() > 0.6) { g.fillStyle = '#a0522d'; g.fillRect(2, 6, 1, 1); g.fillRect(5, 6, 1, 1); }
}

// ---------- rendering ----------
const hasKey = (provider) => !C.PROVIDERS[provider].key || !!config.keys[C.PROVIDERS[provider].key];

function renderStatus() {
  const phase = state.phase || 'idle';
  const pill = $('#statusPill');
  pill.className = 'status ' + ({ running: 'running', error: 'error', idle: '' }[phase] ?? 'busy');
  $('#statusText').textContent = { idle: 'Offline', installing: 'Setting up…', starting: 'Starting…', running: 'Online', stopping: 'Saving…', error: 'Problem' }[phase];

  const world = C.WORLDS[state.world || config.world];
  $('#worldBadge').textContent = `${world.emoji} ${world.label}`;
  const titles = {
    idle: 'Ready when you are', installing: 'Getting everything ready…', starting: 'Waking up the world…',
    running: 'The world is open!', stopping: 'Saving your world…', error: 'Uh oh, something went wrong',
  };
  $('#heroTitle').textContent = titles[phase];
  const bots = config.profiles.filter((p) => p.enabled && hasKey(p.provider));
  $('#heroSub').textContent = phase === 'running'
    ? (world.ai ? (bots.length ? `${bots.map((b) => b.name).join(', ')} ${bots.length > 1 ? 'are' : 'is'} joining you.` : 'No AI friends are switched on.') : 'AI friends can\'t join this modded world - switch to Buddy World to play with them.')
    : phase === 'idle' ? (world.ai ? `Press PLAY to open ${world.label} with ${bots.length || 'no'} AI friend${bots.length === 1 ? '' : 's'}.` : `Press PLAY to open ${world.label}.`)
    : phase === 'installing' ? 'The first time takes a few minutes - it downloads Minecraft, Java, mods and the AI brain.' : '';

  const busy = ['installing', 'starting', 'stopping'].includes(phase);
  const prog = $('#progress');
  prog.classList.toggle('hidden', !busy);
  if (busy) {
    const p = state.progress || {};
    prog.classList.toggle('indeterminate', p.pct == null);
    $('#progressBar').style.width = (p.pct ?? 100) + '%';
    $('#progressLabel').textContent = (p.label || 'Working…') + (p.pct != null ? ` - ${p.pct}%` : '');
  }
  $('#errorBox').classList.toggle('hidden', !state.error);
  $('#errorBox').textContent = state.error || '';

  const play = $('#playBtn');
  play.disabled = phase !== 'idle' && phase !== 'error';
  play.textContent = phase === 'running' ? '✔ PLAYING' : busy ? '… WAIT' : '▶ PLAY';
  $('#stopBtn').classList.toggle('hidden', !['running', 'starting', 'installing'].includes(phase));
  $('#quickActions').classList.toggle('hidden', phase !== 'running');
  $('#restartBotsBtn').classList.toggle('hidden', !world.ai);
  $('#bringBtn').classList.toggle('hidden', !world.ai);

  $('#onlineList').textContent = state.online?.length ? state.online.join(', ') : 'nobody yet';
}

function renderJoin() {
  $$('.mcv').forEach((e) => (e.textContent = C.MC_VERSION));
  const world = C.WORLDS[config.world];
  $('#joinProfileHint').innerHTML = world.ai
    ? '<br><span class="muted small">Plain Minecraft works. Your CurseForge "magic" profile works too if the modded items are switched off.</span>'
    : '<br><span class="muted small">Use your CurseForge "magic" profile.</span>';
  const rows = [['localhost', 'on this computer'], ...lan.map((ip) => [ip, 'from another computer at home'])];
  $('#addresses').innerHTML = rows.map(([a, hint]) =>
    `<div class="addr"><span>${esc(a)}</span><small>${esc(hint)} <button class="btn small ghost" data-copy="${esc(a)}">Copy</button></small></div>`).join('');
}

function renderFriends() {
  const grid = $('#friendsGrid');
  grid.innerHTML = '';
  for (const p of config.profiles) {
    const preset = C.PRESETS.find((x) => x.id === p.preset);
    const card = document.createElement('div');
    card.className = 'card friend' + (p.enabled ? '' : ' off');
    card.style.setProperty('--c', p.color);
    card.innerHTML = `
      <div class="top"><canvas class="face" width="8" height="8"></canvas>
        <div><div class="name">${esc(p.name)}</div><div class="meta">${esc(preset ? preset.emoji + ' ' + preset.label : 'Custom')}</div>
        <div class="meta">${esc(C.PROVIDERS[p.provider].label.split(' ')[0])} · ${esc(p.model)}</div></div></div>
      <div class="persona">${esc(p.personality)}</div>
      ${hasKey(p.provider) ? '' : `<div class="warn">⚠ Needs a ${esc(C.PROVIDERS[p.provider].label)} key</div>`}
      <div class="actions">
        <label class="toggle" title="Joins the world"><input type="checkbox" ${p.enabled ? 'checked' : ''}><span></span></label>
        <button class="btn small ghost" data-act="edit">Edit</button>
        <button class="btn small danger" data-act="del">Delete</button>
      </div>`;
    drawFace($('canvas', card), p.name, p.color);
    $('input', card).onchange = (e) => api('/api/profiles', { profile: { ...p, enabled: e.target.checked } }).catch((err) => toast(err.message));
    $('[data-act=edit]', card).onclick = () => openEditor(p);
    $('[data-act=del]', card).onclick = () => { if (confirm(`Say goodbye to ${p.name}? Their memories stay saved.`)) api('/api/profiles/delete', { id: p.id }); };
    grid.append(card);
  }
  const add = document.createElement('button');
  add.className = 'card add-card';
  add.innerHTML = '<span class="plus">+</span>New AI friend';
  add.onclick = () => openEditor(null);
  grid.append(add);
}

function renderWorlds() {
  $('#worldsGrid').innerHTML = Object.entries(C.WORLDS).map(([id, w]) => `
    <div class="card world ${config.world === id ? 'selected' : ''}" data-world="${id}">
      <div class="emoji">${w.emoji}</div><h3>${esc(w.label)}</h3>
      <p>${esc(w.blurb)}</p>
      <span class="pill ${w.ai ? '' : 'no'}">${w.ai ? '🤖 AI friends can join' : '🚫 No AI friends'}</span>
      <p class="muted small">Server mods: ${w.mods.map(esc).join(', ')}</p>
    </div>`).join('');
  $$('.world').forEach((el) => (el.onclick = async () => {
    if (!['idle', 'error'].includes(state.phase)) return toast('Press Stop before switching worlds.');
    await api('/api/settings', { world: el.dataset.world });
    toast(`${C.WORLDS[el.dataset.world].label} selected`);
  }));
}

function renderKeys() {
  const list = $('#keysList');
  list.innerHTML = '';
  for (const [id, p] of Object.entries(C.PROVIDERS)) {
    if (!p.key) continue;
    const row = document.createElement('div');
    row.className = 'keyrow';
    const saved = config.keys[p.key];
    row.innerHTML = `
      <div><b>${esc(p.label)}</b><br><a href="${esc(p.keyUrl)}" target="_blank" rel="noopener" class="small">Get a key ↗</a></div>
      <input type="password" placeholder="${saved ? 'Saved ' + esc(saved) + ' - paste to replace' : 'Paste key here'}" autocomplete="off">
      <button class="btn small">Save & test</button>
      <span class="result">${saved ? '<span class="ok">✔ saved</span>' : ''}</span>`;
    const input = $('input', row);
    $('button', row).onclick = async () => {
      const key = input.value.trim();
      const out = $('.result', row);
      out.innerHTML = '…';
      const t = await api('/api/keys/test', { provider: id, key });
      if (key && t.ok) { await api('/api/keys', { keys: { [p.key]: key } }); return toast(`${p.label} key saved`); }
      out.innerHTML = `<span class="${t.ok ? 'ok' : 'bad'}">${t.ok ? '✔' : '✖'} ${esc(t.msg)}</span>`;
    };
    list.append(row);
  }
}

function renderSettings() {
  $('#setPlayers').value = config.players.join(', ');
  $('#setDifficulty').value = config.difficulty;
  $('#setGamemode').value = config.gamemode;
  $('#setMemory').value = String(config.memoryGB);
  $('#setFamily').checked = config.familyOnly;
  $('#setKeepInv').checked = config.keepInventory;
  $('#setAuto').checked = config.autoStart;
}

function renderLogs() {
  const view = $('#logView');
  const atBottom = view.scrollTop + view.clientHeight >= view.scrollHeight - 30;
  view.textContent = logs[logTab].join('\n');
  if (atBottom) view.scrollTop = view.scrollHeight;
}

function renderAll() {
  renderStatus(); renderJoin(); renderFriends(); renderWorlds(); renderKeys(); renderSettings(); renderLogs();
}

// ---------- friend editor ----------
let editing = null;
function fillProviderSelect(sel, current) {
  sel.innerHTML = Object.entries(C.PROVIDERS).map(([id, p]) =>
    `<option value="${id}" ${id === current ? 'selected' : ''}>${esc(p.label)}${hasKey(id) ? '' : ' (no key yet)'}</option>`).join('');
}

function openEditor(p) {
  editing = p ? structuredClone(p) : {
    name: '', enabled: true, preset: C.PRESETS[0].id, color: C.PRESETS[0].color, provider: 'anthropic',
    model: C.PROVIDERS.anthropic.models[0], speed: 'fast', personality: C.PRESETS[0].text, modes: {},
  };
  const firstProvider = Object.keys(C.PROVIDERS).find((id) => C.PROVIDERS[id].key && hasKey(id));
  if (!p && firstProvider) { editing.provider = firstProvider; editing.model = C.PROVIDERS[firstProvider].models[0]; }
  $('#edTitle').textContent = p ? `Edit ${p.name}` : 'New AI friend';
  $('#edName').value = editing.name;
  $('#edPersonality').value = editing.personality;
  $('#edEnabled').checked = editing.enabled;
  $('#edPresets').innerHTML = C.PRESETS.map((x) => `<button type="button" class="chip ${x.id === editing.preset ? 'active' : ''}" data-preset="${x.id}">${x.emoji} ${esc(x.label)}</button>`).join('');
  $$('#edPresets .chip').forEach((b) => (b.onclick = () => {
    const x = C.PRESETS.find((y) => y.id === b.dataset.preset);
    editing.preset = x.id; editing.color = x.color;
    $('#edPersonality').value = x.text;
    $$('#edPresets .chip').forEach((c) => c.classList.toggle('active', c === b));
    drawFace($('#edFace'), $('#edName').value, editing.color);
  }));
  fillProviderSelect($('#edProvider'), editing.provider);
  $('#edSpeed').innerHTML = Object.entries(C.SPEEDS).map(([id, s]) => `<option value="${id}" ${id === editing.speed ? 'selected' : ''}>${esc(s.label)}</option>`).join('');
  $('#edModel').value = editing.model;
  onProviderChange(false);
  $('#edModes').innerHTML = Object.entries(C.MODES).map(([id, label]) =>
    `<label class="toggle"><input type="checkbox" data-mode="${id}" ${(editing.modes[id] ?? defaultMode(id)) ? 'checked' : ''}><span></span>${esc(label)}</label>`).join('');
  $('#edError').classList.add('hidden');
  drawFace($('#edFace'), editing.name, editing.color);
  $('#editor').showModal();
}
const defaultMode = (id) => !['cowardice', 'cheat'].includes(id);

function onProviderChange(resetModel = true) {
  const id = $('#edProvider').value;
  const prov = C.PROVIDERS[id];
  $('#edModels').innerHTML = prov.models.map((m) => `<option value="${esc(m)}">`).join('');
  if (resetModel) $('#edModel').value = prov.models[0];
  $('#edSpeedWrap').classList.toggle('hidden', id !== 'anthropic');
  $('#edProviderNote').innerHTML = [prov.note ? esc(prov.note) : '', hasKey(id) ? '' : `⚠ You'll need to add a key on the AI Keys tab. <a href="${esc(prov.keyUrl)}" target="_blank" rel="noopener">Get one ↗</a>`].filter(Boolean).join(' ');
}

$('#edProvider').onchange = () => onProviderChange(true);
$('#edName').oninput = (e) => drawFace($('#edFace'), e.target.value, editing.color);
$('#editorForm').onsubmit = async (e) => {
  if (e.submitter?.value !== 'save') return;
  e.preventDefault();
  const profile = {
    ...editing, name: $('#edName').value.trim(), personality: $('#edPersonality').value.trim(),
    provider: $('#edProvider').value, model: $('#edModel').value.trim(), speed: $('#edSpeed').value,
    enabled: $('#edEnabled').checked,
    modes: Object.fromEntries($$('#edModes input').map((i) => [i.dataset.mode, i.checked])),
  };
  try {
    await api('/api/profiles', { profile });
    $('#editor').close();
    toast(`${profile.name} saved${state.phase === 'running' ? ' - rejoining the world' : ''}`);
  } catch (err) {
    $('#edError').textContent = err.message;
    $('#edError').classList.remove('hidden');
  }
};

// ---------- first-run wizard ----------
const wiz = { step: 0, provider: 'anthropic', key: '', keyOk: false, players: '', world: 'buddy', friendName: 'Buddy', preset: 'buddy' };
const WIZ_STEPS = [
  () => `<div class="big-emoji">⛏️🤖</div><h2>Welcome to AI Buddies!</h2>
    <p>This sets up your own Minecraft world where AI friends play alongside you - they follow you around, help build, fight mobs, gather stuff, and remember you between games.</p>
    <p class="muted">It takes about 2 minutes. You'll need an API key from an AI company (we'll show you where to get one).</p>`,
  () => `<h2>Who's playing?</h2><p>Type your Minecraft usernames so the server lets you in and makes you admins.</p>
    <label>Minecraft names (comma separated)<input id="wzPlayers" placeholder="DadCrafter, CoolKid2015" value="${esc(wiz.players)}"></label>
    <p class="muted small">Find them in the Minecraft launcher or CurseForge, top right.</p>`,
  () => `<h2>Give your friends a brain 🧠</h2><p>Pick an AI company and paste your API key. You pay the AI company for what the friends use - usually a few cents to a couple of dollars per play session.</p>
    <label>AI company<select id="wzProvider"></select></label>
    <label>API key<input id="wzKey" type="password" placeholder="Paste your key" value="${esc(wiz.key)}" autocomplete="off"></label>
    <div class="row gap"><button class="btn small" id="wzTest" type="button">Test key</button><a id="wzKeyUrl" target="_blank" rel="noopener">Where do I get a key? ↗</a></div>
    <p id="wzKeyMsg" class="small"></p>`,
  () => `<h2>Create your first AI friend</h2>
    <div class="row gap"><canvas class="face big" id="wzFace" width="8" height="8"></canvas><label>Name<input id="wzName" maxlength="16" value="${esc(wiz.friendName)}"></label></div>
    <div class="label">Personality</div><div class="presets" id="wzPresets"></div>
    <p class="muted small">You can add more friends and write your own personalities later.</p>`,
  () => `<h2>Pick your world</h2>${Object.entries(C.WORLDS).map(([id, w]) => `
    <div class="choice ${wiz.world === id ? 'selected' : ''}" data-world="${id}"><div class="big-emoji">${w.emoji}</div>
    <div><b>${esc(w.label)}</b> <span class="pill ${w.ai ? '' : 'no'}">${w.ai ? 'AI friends ✔' : 'No AI friends'}</span><p class="small">${esc(w.blurb)}</p></div></div>`).join('')}
    <p class="muted small">You can switch any time on the Worlds tab.</p>`,
  () => `<div class="big-emoji">🎉</div><h2>All set!</h2><p>Press <b>Let's play</b>. The first start downloads Minecraft, Java, mods and the AI brain (a few minutes). After that, just double-click <b>Start Minecraft AI</b> and it opens by itself.</p>
    <p class="muted small">If Windows asks about the firewall, click <b>Allow</b> so other computers at home can join.</p>`,
];

function renderWizard() {
  $('#wizDots').innerHTML = WIZ_STEPS.map((_, i) => `<span class="${i <= wiz.step ? 'done' : ''}"></span>`).join('');
  $('#wizBody').innerHTML = WIZ_STEPS[wiz.step]();
  $('#wizBack').classList.toggle('hidden', wiz.step === 0);
  $('#wizNext').textContent = wiz.step === WIZ_STEPS.length - 1 ? "▶ Let's play" : 'Next';
  if (wiz.step === 2) {
    fillProviderSelect($('#wzProvider'), wiz.provider);
    const sync = () => {
      const p = C.PROVIDERS[$('#wzProvider').value];
      $('#wzKeyUrl').href = p.keyUrl;
      $('#wzKey').disabled = !p.key;
      $('#wzKeyMsg').textContent = p.note || '';
    };
    sync();
    $('#wzProvider').onchange = () => { wiz.provider = $('#wzProvider').value; wiz.keyOk = false; sync(); };
    $('#wzTest').onclick = testWizardKey;
  }
  if (wiz.step === 3) {
    const preset = () => C.PRESETS.find((x) => x.id === wiz.preset);
    $('#wzPresets').innerHTML = C.PRESETS.map((x) => `<button type="button" class="chip ${x.id === wiz.preset ? 'active' : ''}" data-preset="${x.id}" title="${esc(x.text)}">${x.emoji} ${esc(x.label)}</button>`).join('');
    const redraw = () => drawFace($('#wzFace'), $('#wzName').value, preset().color);
    $$('#wzPresets .chip').forEach((b) => (b.onclick = () => { wiz.preset = b.dataset.preset; $$('#wzPresets .chip').forEach((c) => c.classList.toggle('active', c === b)); redraw(); }));
    $('#wzName').oninput = redraw;
    redraw();
  }
  if (wiz.step === 4) $$('.choice').forEach((el) => (el.onclick = () => { wiz.world = el.dataset.world; renderWizard(); }));
}

async function testWizardKey() {
  wiz.key = $('#wzKey').value.trim();
  $('#wzKeyMsg').textContent = 'Testing…';
  const t = await api('/api/keys/test', { provider: wiz.provider, key: wiz.key });
  wiz.keyOk = t.ok;
  $('#wzKeyMsg').innerHTML = `<span style="color:${t.ok ? 'var(--grass)' : 'var(--danger)'}">${t.ok ? '✔' : '✖'} ${esc(t.msg)}</span>`;
  return t.ok;
}

$('#wizBack').onclick = () => { wiz.step--; renderWizard(); };
$('#wizNext').onclick = async () => {
  try {
    if (wiz.step === 1) {
      wiz.players = $('#wzPlayers').value;
      if (!wiz.players.trim()) return toast('Type at least one Minecraft name');
    }
    if (wiz.step === 2) {
      const prov = C.PROVIDERS[wiz.provider];
      if (prov.key) {
        wiz.key = $('#wzKey').value.trim();
        if (!wiz.key && !config.keys[prov.key]) return toast('Paste an API key first');
        if (wiz.key && !wiz.keyOk && !(await testWizardKey())) return;
        if (wiz.key) await api('/api/keys', { keys: { [prov.key]: wiz.key } });
      }
    }
    if (wiz.step === 3) {
      wiz.friendName = $('#wzName').value.trim();
      if (!/^\w{3,16}$/.test(wiz.friendName)) return toast('Names need 3-16 letters or numbers, no spaces');
    }
    if (wiz.step === WIZ_STEPS.length - 1) return finishWizard();
    wiz.step++;
    renderWizard();
  } catch (err) { toast(err.message); }
};

async function finishWizard() {
  const preset = C.PRESETS.find((x) => x.id === wiz.preset);
  const existing = config.profiles[0];
  const prov = C.PROVIDERS[wiz.provider];
  const profile = {
    ...(existing || {}), name: wiz.friendName, preset: preset.id, color: preset.color, personality: preset.text,
    provider: wiz.provider, model: prov.models[0], enabled: true,
  };
  await api('/api/profiles', { profile });
  await api('/api/settings', { players: wiz.players.split(','), world: wiz.world, setupDone: true });
  $('#wizard').close();
  api('/api/start', {});
}

function openWizard() {
  wiz.step = 0;
  wiz.players = config.players.join(', ');
  wiz.world = config.world;
  if (config.profiles[0]) { wiz.friendName = config.profiles[0].name; wiz.preset = config.profiles[0].preset; wiz.provider = config.profiles[0].provider; }
  renderWizard();
  $('#wizard').showModal();
}

// ---------- wiring ----------
$('#playBtn').onclick = () => (config.setupDone ? api('/api/start', {}) : openWizard());
$('#stopBtn').onclick = () => api('/api/stop', {});
$$('#tabs button').forEach((b) => (b.onclick = () => {
  $$('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
  $$('.tab').forEach((t) => t.classList.toggle('hidden', t.id !== 'tab-' + b.dataset.tab));
  if (b.dataset.tab === 'logs') renderLogs();
}));
$$('[data-log]').forEach((b) => (b.onclick = () => { logTab = b.dataset.log; $$('[data-log]').forEach((x) => x.classList.toggle('active', x === b)); renderLogs(); }));
$$('[data-cmd]').forEach((b) => (b.onclick = () => api('/api/command', { command: b.dataset.cmd }).then(() => toast('Done!')).catch((e) => toast(e.message))));
$$('[data-open]').forEach((b) => (b.onclick = () => api('/api/open', { what: b.dataset.open })));
$('#bringBtn').onclick = async () => {
  const who = state.online.filter((n) => !config.profiles.some((p) => p.name === n));
  const target = who.length === 1 ? who[0] : prompt(`Bring the AI friends to which player?\n(${who.join(', ') || 'nobody online'})`, who[0] || '');
  if (!target) return;
  for (const p of config.profiles.filter((x) => state.online.includes(x.name))) await api('/api/command', { command: `tp ${p.name} ${target}` });
  toast(`Friends teleported to ${target}`);
};
$('#restartBotsBtn').onclick = () => api('/api/restart-bots', {}).then(() => toast('Restarting AI friends…'));
$('#cmdForm').onsubmit = (e) => { e.preventDefault(); const v = $('#cmdInput').value.trim(); if (v) api('/api/command', { command: v }).catch((err) => toast(err.message)); $('#cmdInput').value = ''; };
$('#saveSettings').onclick = () => api('/api/settings', {
  players: $('#setPlayers').value.split(','), difficulty: $('#setDifficulty').value, gamemode: $('#setGamemode').value,
  memoryGB: Number($('#setMemory').value), familyOnly: $('#setFamily').checked, keepInventory: $('#setKeepInv').checked, autoStart: $('#setAuto').checked,
}).then(() => toast('Settings saved'));
$('#rerunWizard').onclick = openWizard;
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-copy]');
  if (c) navigator.clipboard.writeText(c.dataset.copy).then(() => toast(`Copied ${c.dataset.copy}`));
});

function connectEvents() {
  const es = new EventSource('/api/events');
  es.onmessage = (m) => {
    const ev = JSON.parse(m.data);
    if (ev.type === 'state') { state = ev.state; renderStatus(); }
    if (ev.type === 'log') {
      logs[ev.src].push(ev.line);
      if (logs[ev.src].length > 800) logs[ev.src].shift();
      if (ev.src === logTab && !$('#tab-logs').classList.contains('hidden')) renderLogs();
    }
  };
  es.onerror = () => { $('#statusText').textContent = 'Panel closed'; $('#statusPill').className = 'status error'; };
}

(async function init() {
  const boot = await api('/api/bootstrap');
  C = boot.catalog; config = boot.config; state = boot.state; logs = boot.logs; lan = boot.lan;
  renderAll();
  connectEvents();
  if (!config.setupDone) openWizard();
})();
