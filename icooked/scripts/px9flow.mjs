// PX-9 pendant / feeder / camera-check flow and the clipboard, driven with clicks.
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
await page.evaluate(() => { window.icooked.setQuality('low'); window.icooked.startRun(4242); });
await page.waitForTimeout(1500);
const log = (...a) => console.log('•', ...a);
const G = (fn, arg) => page.evaluate(fn, arg);
const enter = async (id) => {
  await G(() => { const a = window.icooked; if (a.active) a.leaveStation(); });
  await page.waitForFunction(() => !window.icooked.player.parked, null, { timeout: 30000 }).catch(() => {});
  await G((id) => { const a = window.icooked; const s = a.stations.get(id); a.player.pos.set(s.spot.at.x, 0, s.spot.at.z); a.enterStation(s); }, id);
  await page.waitForFunction(() => window.icooked.active?.root.isConnected, null, { timeout: 30000 });
  await page.waitForTimeout(500);
};

// Office printer: grab the waiting card.
await enter('office');
await page.getByText('Take them and clip').click();
log('cards held', await G(() => window.icooked.game.jobs.filter((j) => j.card === 'held').map((j) => j.product.asmIpn)));
// Clipboard
await page.keyboard.press('KeyC');
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/p01-clipboard.png` });
await page.keyboard.press('KeyC');

// PX-9: load the job.
await enter('px9');
await page.locator('.px9-win button', { hasText: 'Load' }).first().click();
log('active', await G(() => window.icooked.game.activeJob?.product.asmIpn));
await page.locator('.px9-win button', { hasText: 'Program check' }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/p02-camera.png` });
await page.locator('.px9-win button', { hasText: 'X+' }).click();
await page.locator('.px9-win button', { hasText: 'Accept' }).click();
log('checked', await G(() => Object.keys(window.icooked.game.activeJob.program.checked).length));

// Feeders: pull slot 1 while running -> fault.
await page.locator('.px9-win button', { hasText: 'Feeders' }).click();
await page.locator('.px9-win .slot').nth(0).click();
await page.locator('.px9-win button', { hasText: 'Pull feeder' }).click();
log('after pull', await G(() => ({ ...window.icooked.game.line })).then((l) => `${l.machine} feederOut=${l.feederOut}`));
const tb = await page.locator('.px9-win canvas').boundingBox();
await page.mouse.click(tb.x + tb.width * 0.6, tb.y + tb.height * 0.55);
log('hand', await G(() => JSON.stringify(window.icooked.game.hand)));
await page.screenshot({ path: `${out}/p03-feeder-out.png` });
await page.locator('.px9-win button', { hasText: 'Seat the feeder' }).click();
await page.locator('.pend-btn.start').click();
log('start while faulted ->', await G(() => window.icooked.game.line.machine));
await page.locator('.estop').click();
await page.locator('.estop').click();
log('estop', await G(() => window.icooked.game.line.estop));
await page.locator('.pendant button', { hasText: 'twist' }).click();
await page.locator('.pend-btn.start').click();
log('after reset', await G(() => `${window.icooked.game.line.machine} estop=${window.icooked.game.line.estop}`));
await page.screenshot({ path: `${out}/p04-pendant.png` });
fs.writeFileSync(`${out}/px9-errors.txt`, errors.join('\n'));
console.log(errors.slice(0, 5).join('\n') || 'no page errors');
await browser.close();
