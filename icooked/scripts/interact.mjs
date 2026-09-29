// Drives the stations with real mouse/keyboard input and reports what happened.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const out = process.argv[2] ?? 'shots';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${e.stack}`));
await page.goto(process.env.URL ?? 'http://localhost:4173/');
await page.waitForTimeout(2000);
await page.getByText('Clock in').click();
await page.waitForTimeout(2000);
const log = (...a) => console.log('•', ...a);
const G = (fn, arg) => page.evaluate(fn, arg);
const enter = async (id) => {
  await G(() => { const a = window.icooked; if (a.active) a.leaveStation(); });
  await page.waitForFunction(() => !window.icooked.player.parked, null, { timeout: 30000 }).catch(() => {});
  await G((id) => { const a = window.icooked; const s = a.stations.get(id); a.player.pos.set(s.spot.at.x, 0, s.spot.at.z); a.player.faceTowards(s.spot.viewLook); }, id);
  await page.waitForTimeout(800);
  const prompt = await page.locator('.prompt').textContent().catch(() => '');
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.icooked.active?.root.isConnected, null, { timeout: 30000 });
  log(`entered ${id} via E (prompt: ${prompt?.trim()})`);
};

// 1. PX-9: load the in-house job
await enter('px9');
await page.locator('.station button.rbtn.go', { hasText: 'Load' }).first().click();
await page.waitForTimeout(500);
log('active job', await G(() => window.icooked.game.activeJob?.product.asmIpn));

// 2. Feeders: load every slot on the set-up sheet by clicking
await enter('feeders');
const setup = await G(() => Object.entries(window.icooked.game.activeJob.program.setup));
for (const [ipn, slot] of setup) {
  if (await G((s) => window.icooked.game.slots[s].reel?.label, slot) === ipn) continue;
  await page.locator('.slot').nth(slot).click();
  await page.locator('.reelbtn', { hasText: ipn }).first().click();
  await page.waitForFunction((s) => !!window.icooked.game.slots[s[0]].reel && window.icooked.game.slots[s[0]].reel.label === s[1], [slot, ipn], { timeout: 20000 }).catch(() => log('load failed', ipn));
}
log('missing after loading', await G(() => { const g = window.icooked.game; const j = g.activeJob; return Object.entries(j.program.setup).filter(([i, s]) => g.slots[s].reel?.label !== i).length; }));
await page.screenshot({ path: `${out}/i01-feeders.png` });

// 3. Printer: squeegee stroke with the mouse
await enter('printer');
const box = await page.locator('.stencil-wrap canvas').boundingBox();
const view = await G(() => window.icooked.active.view);
const y = box.y + box.height / 2;
await page.mouse.move(box.x + view.ox - 10, y);
await page.mouse.down();
const x0 = box.x + view.ox - 10;
const x1 = box.x + view.ox + (box.width - 2 * view.ox) + 20;
for (let i = 0; i <= 30; i++) {
  await page.mouse.move(x0 + ((x1 - x0) * i) / 30, y + Math.sin(i) * 2);
  await page.waitForTimeout(50);
}
await page.mouse.up();
await page.waitForTimeout(300);
const res = await G(() => window.icooked.active.result);
log('print result pads', res ? `${res.length}, good=${res.filter((v) => v >= 0.7 && v <= 1.35).length} sample=${res.slice(0, 12).map((v) => v.toFixed(2))}` : 'none');
log('samples', await G(() => { const S = window.icooked.active.samples; return S.length + ' ' + (S[S.length - 1].t - S[0].t).toFixed(2) + 's ' + JSON.stringify(S.slice(0, 5).map((s) => [Math.round(s.x), +(s.t - S[0].t).toFixed(3)])); }));
await page.screenshot({ path: `${out}/i02-printer.png` });
await page.getByText('Accept print set-up').click();
log('profile set', await G(() => !!window.icooked.game.activeJob.printProfile));

// 4. Let the line run to inspection, then nudge a part with tweezers
await G(() => { const g = window.icooked.game; for (const k of g.stores.keys()) g.stores.set(k, 5000); for (let i = 0; i < 20 * 400 && !g.panels.some((p) => p.stage === 'inspect'); i++) { g.tick(0.05); if (g.line.px9Alarm) { const s = g.line.px9AlarmSlot; const ipn = Object.entries(g.activeJob.program.setup).find(([, v]) => v === s)[0]; if (g.slots[s].reel?.jam) g.clearJam(s); else g.loadFromStores(s, ipn); } } const p = g.panels.find((q) => q.stage === 'inspect'); if (p) p.held = true; });
await enter('inspect');
await page.waitForTimeout(1500);
const target = await G(() => {
  const a = window.icooked; const b = a.bench.inst; const p = b.parts.find((q) => q.placed && q.pkg === '0603') ?? b.parts.find((q) => q.placed);
  a.bench.focusOn(p.x, p.y, 25);
  return { des: p.des, x: p.x + p.dx, y: p.y + p.dy, dx: p.dx, dy: p.dy };
});
await page.waitForTimeout(2500);
const scr = await G((t) => {
  const a = window.icooked; const v = new window.THREEVector(t.x, 0.3, -t.y);
  v.project(a.bench.camera);
  return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
}, target).catch(() => null);
if (scr) {
  await page.mouse.move(scr.x, scr.y);
  await page.waitForTimeout(600);
  await page.mouse.down();
  for (let i = 0; i < 10; i++) { await page.mouse.move(scr.x + i * 2, scr.y); await page.waitForTimeout(60); }
  await page.mouse.up();
  const after = await G((d) => { const p = window.icooked.bench.inst.parts.find((q) => q.des === d); return { dx: p.dx, dy: p.dy, placed: p.placed }; }, target.des);
  log('nudge', target.des, 'before', target.dx.toFixed(3), 'after', after.dx.toFixed(3), after.placed ? 'still placed' : 'FLICKED');
  log('tweezers at', await G(() => window.icooked.toolAt.tweezers));
}
await page.screenshot({ path: `${out}/i03-inspect.png` });
await page.keyboard.press('KeyQ');
await page.waitForTimeout(500);
log('left inspect; toast', await page.locator('.toast').first().textContent());

// 5. Oven maintenance
await enter('oven');
await page.getByText('Stop feed').click();
await G(() => { const g = window.icooked.game; for (let i = 0; i < 20 * 60 && g.panels.some((p) => p.stage === 'oven'); i++) g.tick(0.05); });
await page.waitForTimeout(800);
await page.getByText('Start maintenance').click();
await page.waitForTimeout(1500);
const ob = await page.locator('.hmi canvas').boundingBox();
const blobs = await G(() => window.icooked.active.blobs.map((b) => ({ x: b.x, y: b.y })));
log('blobs', blobs.length, 'maint', await G(() => window.icooked.game.line.maintenance));
for (const b of blobs) {
  await page.mouse.move(ob.x + b.x - 30, ob.y + b.y);
  await page.mouse.down();
  for (let k = 0; k < 14; k++) { await page.mouse.move(ob.x + b.x + (k % 2 ? 30 : -30), ob.y + b.y + (k % 3) * 4); await page.waitForTimeout(30); }
  await page.mouse.up();
}
await page.waitForTimeout(1500);
log('maintenance done?', await G(() => ({ m: window.icooked.game.line.maintenance, count: window.icooked.game.maintCount, heat: window.icooked.game.heat })));
await page.screenshot({ path: `${out}/i04-oven.png` });

fs.writeFileSync(`${out}/interact-errors.txt`, errors.join('\n'));
console.log(errors.slice(0, 10).join('\n') || 'no page errors');
await browser.close();
