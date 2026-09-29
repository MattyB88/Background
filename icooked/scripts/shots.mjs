// Headless screenshot tour of the game. Usage: node scripts/shots.mjs [outDir]
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
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${e.stack}`));
await page.goto(process.env.URL ?? 'http://localhost:4173/');
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/01-title.png` });
await page.evaluate(() => window.icooked.startRun(12345));
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/02-walk.png` });

const tour = process.env.TOUR ? process.env.TOUR.split(',') : ['desk', 'feeders', 'printer', 'px9', 'oven', 'aoi', 'test', 'inspect', 'rework'];
let i = 3;
for (const id of tour) {
  await page.evaluate(() => {
    const a = window.icooked;
    if (a.active) a.leaveStation();
  });
  await page.waitForFunction(() => !window.icooked.player.parked, null, { timeout: 30000 }).catch(() => {});
  await page.evaluate((id) => {
    const a = window.icooked;
    const s = a.stations.get(id);
    a.player.pos.set(s.spot.at.x, 0, s.spot.at.z);
    a.enterStation(s);
  }, id);
  await page.waitForFunction(() => window.icooked.active?.root.isConnected, null, { timeout: 30000 }).catch(() => console.log('station UI did not appear:', id));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/${String(i++).padStart(2, '0')}-${id}.png` });
}
fs.writeFileSync(`${out}/errors.txt`, errors.join('\n'));
console.log(errors.slice(0, 20).join('\n') || 'no console errors');
await browser.close();
