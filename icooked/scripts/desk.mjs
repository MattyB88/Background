// Plays the programming desk with real clicks: accept, find release, fill BOM blanks, fids, teach, save.
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
await page.evaluate(() => window.icooked.startRun(4242));
await page.waitForTimeout(1500);
const log = (...a) => console.log('•', ...a);
const G = (fn, arg) => page.evaluate(fn, arg);
await G(() => { const a = window.icooked; const s = a.stations.get('desk'); a.player.pos.set(s.spot.at.x, 0, s.spot.at.z); a.enterStation(s); });
await page.waitForFunction(() => window.icooked.active?.root.isConnected, null, { timeout: 30000 });

await page.locator('.win button', { hasText: 'Accept' }).first().click();
log('accepted', await G(() => window.icooked.game.jobs.find((j) => j.status === 'accepted')?.product.asmIpn));
// Find the right folder the way a player would: ERP assemblies says the PCB rev.
const { correctName, rev } = await G(() => { const j = window.icooked.active.job; const f = j.puzzle.folders.find((x) => x.correct); return { correctName: f.name, rev: j.product.rev }; });
await page.locator('.dock button', { hasText: 'Baselines' }).click();
await page.locator('.folder-row', { hasText: correctName }).first().click();
await page.locator('.win button', { hasText: 'Use this release' }).click();
await page.waitForTimeout(300);
log('folder in use', correctName, rev);

// Fill blanks using the truth (simulating a perfect puzzle solver) through the pickers.
const blanks = await G(() => {
  const d = window.icooked.active; const j = d.job; const f = j.puzzle.folders[d.workFor(j).folder];
  return f.rows.map((r, i) => ({ i, kind: r.ipnKind, truth: r.truthIpn, des: r.shownDes.map((x, si) => (x === null ? r.truthDes[si] : null)), gamble: r.ipnGamble }));
});
for (const b of blanks) {
  const row = page.locator('.win', { hasText: 'bomedit' }).locator('table.grid tr').nth(b.i + 1);
  if (b.kind !== 'given') {
    await row.locator('td.cell-ipn').click();
    await page.locator('.picker div', { hasText: b.truth }).first().click();
  }
  for (const d of b.des) {
    if (!d) continue;
    await row.locator('span.blank').first().click();
    await page.locator('.picker div').filter({ hasText: new RegExp(`^${d}( |$)`) }).first().click();
  }
}
log('blank rows', blanks.filter((b) => b.kind !== 'given' || b.des.some(Boolean)).length);
await page.screenshot({ path: `${out}/d01-bom.png` });

// Programmer
await page.locator('.dock button', { hasText: 'PX-9 Prog' }).click();
await page.locator('.win button', { hasText: 'Create layout' }).click();
await page.locator('.win button', { hasText: '3 Fiducials' }).click();
const fids = await G(() => window.icooked.active.job.product.board.fids.map((f) => ({ x: f.x, y: f.y, shape: f.shape, contrast: f.contrast })));
const def = await G(() => ({ w: window.icooked.active.job.product.board.w, h: window.icooked.active.job.product.board.h }));
for (let k = 0; k < 2; k++) {
  const c = page.locator('.win canvas').first();
  const bb = await c.boundingBox();
  const f = fids[k];
  await page.mouse.click(bb.x + (f.x / def.w) * bb.width, bb.y + (1 - f.y / def.h) * bb.height);
  await page.waitForTimeout(200);
}
const sels = page.locator('.win select');
for (let k = 0; k < 2; k++) {
  await sels.nth(k).selectOption(fids[k].shape);
  const thr = Math.round((0.25 + fids[k].contrast * 0.3) * 100);
  await page.locator('.win input[type=range]').nth(k).fill(String(thr));
}
log('fid quality', await G(() => { const d = window.icooked.active; return d.fidQuality(d.job, d.workFor(d.job)).toFixed(2); }));
await page.screenshot({ path: `${out}/d02-fids.png` });
await page.locator('.win button', { hasText: '4 Packages' }).click();
const untaught = await G(() => { const d = window.icooked.active; return d.packagesOf(d.job).filter((p) => window.icooked.game.taught[p] === undefined); });
log('untaught', untaught.join(','));
for (const pkg of untaught) {
  await G((p) => window.icooked.active.openTeach(p), pkg);
  await page.waitForTimeout(300);
  const win = page.locator('.win', { hasText: `Package teach — ${pkg}` });
  const c = win.locator('canvas');
  const bb = await c.boundingBox();
  // Read where the body is (a player sees it; we cheat and ask).
  await win.locator('button', { hasText: 'side' }).first().click();
  const W = 360, H = 300;
  await page.mouse.move(bb.x + bb.width * 0.35, bb.y + bb.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width * 0.65, bb.y + bb.height * 0.65, { steps: 5 });
  await page.mouse.up();
  await win.locator('button', { hasText: 'Save to library' }).click();
  log('taught', pkg, await G((p) => window.icooked.game.taught[p]?.toFixed(2), pkg), await win.locator('b').last().textContent());
  void W; void H;
  await page.waitForTimeout(1800);
}
await page.screenshot({ path: `${out}/d03-teach.png` });
await G(() => { const d = window.icooked.active; d.step = 5; d.desk.refresh('prog'); });
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/d04-save.png` });
await page.locator('.win button', { hasText: 'Save program' }).click();
await page.waitForTimeout(500);
const res = await G(() => { const g = window.icooked.game; const j = g.jobs.find((x) => x.kind === 'contract' && x.program); return j && { status: j.status, score: g.score, placed: Object.values(j.program.desIpn).filter(Boolean).length, total: j.product.board.placements.length, wrong: j.product.board.placements.filter((p) => j.program.desIpn[p.des] !== p.ipn).map((p) => p.des) }; });
log('saved', JSON.stringify(res));
fs.writeFileSync(`${out}/desk-errors.txt`, errors.join('\n'));
console.log(errors.slice(0, 10).join('\n') || 'no page errors');
await browser.close();
