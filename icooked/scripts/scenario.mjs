// Plays a scripted slice of a shift headlessly and screenshots key moments.
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
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(process.env.URL ?? 'http://localhost:4173/');
await page.waitForTimeout(2000);
await page.evaluate(() => window.icooked.startRun(777));
await page.waitForTimeout(1500);

const shot = async (name) => { await page.waitForTimeout(1200); await page.screenshot({ path: `${out}/${name}.png` }); };
const enter = async (id) => {
  await page.evaluate(() => { const a = window.icooked; if (a.active) a.leaveStation(); });
  await page.waitForFunction(() => !window.icooked.player.parked, null, { timeout: 30000 }).catch(() => {});
  await page.evaluate((id) => { const a = window.icooked; const s = a.stations.get(id); a.player.pos.set(s.spot.at.x, 0, s.spot.at.z); a.enterStation(s); }, id);
  await page.waitForFunction(() => window.icooked.active?.root.isConnected, null, { timeout: 30000 });
};
const sim = (secs, until) => page.evaluate(([secs, until]) => {
  const g = window.icooked.game;
  const stop = until ? new Function('g', `return ${until}`) : () => false;
  for (let i = 0; i < secs / 0.05 && !stop(g) && !g.over; i++) g.tick(0.05);
  return g.t;
}, [secs, until]);

// Set up the in-house job the lazy way, with a few bad pads to create defects.
await page.evaluate(() => {
  const g = window.icooked.game;
  const j = g.jobs.find((x) => x.status === 'ready');
  j.card = 'held';
  g.startJob(j);
  const prof = Array(g.padCount(j)).fill(1).map((v, i) => (i % 17 === 3 ? 0.05 : i % 23 === 5 ? 1.9 : v));
  g.setPrintProfile(j, prof);
  for (const [ipn, s] of Object.entries(j.program.setup)) g.loadFromStores(s, ipn);
  for (const k of g.stores.keys()) g.stores.set(k, 5000);
  for (const s of g.slots) if (s.reel) s.reel.jam = false;
});
await sim(400, "g.panels.some(p => p.stage === 'px9' && p.placedIdx > 30)");
await page.evaluate(() => { const a = window.icooked; a.player.pos.set(-6.5, 0, -0.6); a.player.yaw = 0.5; a.player.pitch = -0.35; });
await shot('s01-px9-placing');
await sim(400, "g.panels.some(p => p.stage === 'inspect')");
await page.evaluate(() => { const p = window.icooked.game.panels.find((q) => q.stage === 'inspect'); if (p) p.held = true; });
await enter('inspect');
await shot('s02-inspect-board');
await page.evaluate(() => { const a = window.icooked; const b = a.bench.inst; const p = b.parts.find(q => q.pkg === 'SOT23' || q.pkg === 'TSSOP16') ?? b.parts[0]; a.bench.focusOn(p.x, p.y, 22); });
await shot('s03-inspect-zoom');
await page.evaluate(() => { const a = window.icooked; a.leaveStation(); });
await page.waitForFunction(() => !window.icooked.player.parked, null, { timeout: 30000 }).catch(() => {});
await sim(600, 'g.rework.length > 0');
await page.evaluate(() => { const a = window.icooked; a.player.pos.set(-1.5, 0, 0.2); a.player.yaw = -0.6; a.player.pitch = -0.25; });
await shot('s04-line-oven');
await enter('rework');
await shot('s05-rework');
await page.evaluate(() => { const a = window.icooked; const b = a.bench.inst; const f = b && a.game.faultsOf(b)[0]; const p = f && b.parts.find(q => q.des === f.des); if (p) a.bench.focusOn(p.x, p.y, 20); });
await shot('s06-rework-zoom');

// Desk: accept the contract and open the tools.
await enter('desk');
await page.evaluate(() => {
  const a = window.icooked; const g = a.game; const d = a.active;
  const j = g.jobs.find((x) => x.kind === 'contract' && x.status === 'offered');
  if (j) { g.acceptJob(j); d.select(j); }
  d.openBaselines();
  d.selFolder = j.puzzle.folders.findIndex((f) => f.correct);
  d.desk.refresh('base');
});
await shot('s07-desk-baselines');
await page.evaluate(() => {
  const a = window.icooked; const d = a.active; const j = d.job;
  const w = d.workFor(j); const f = j.puzzle.folders[d.selFolder];
  w.folder = d.selFolder; w.ipn = f.rows.map(() => null); w.des = f.rows.map((r) => r.shownDes.map(() => null));
  d.openBom(); d.openEngineer(); d.openErp(); d.erpQuery = '100nF'; d.desk.refresh('erp');
});
await shot('s08-desk-bom');
await page.evaluate(() => { const d = window.icooked.active; d.desk.close('erp'); d.desk.close('eng'); d.desk.close('bom'); d.openProg(); d.step = 3; d.desk.refresh('prog'); });
await shot('s09-desk-fids');
await page.evaluate(() => { const d = window.icooked.active; d.openTeach('QFN32'); });
await shot('s10-desk-teach');
await page.evaluate(() => { const a = window.icooked; a.leaveStation(); });
await page.waitForFunction(() => !window.icooked.player.parked, null, { timeout: 30000 }).catch(() => {});
// Fire!
await page.evaluate(() => { const g = window.icooked.game; g.heat = 100; g.end('fire'); });
await page.waitForTimeout(8000);
await shot('s11-fire');
await page.waitForFunction(() => window.icooked.mode === 'over', null, { timeout: 60000 }).catch(() => {});
await shot('s12-endcard');
fs.writeFileSync(`${out}/scenario-errors.txt`, errors.join('\n'));
console.log(errors.slice(0, 10).join('\n') || 'no page errors');
await browser.close();
