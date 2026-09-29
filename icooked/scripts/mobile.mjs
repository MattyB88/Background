// Emulated phone (landscape) check of touch controls.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const out = process.argv[2] ?? 'shots';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(process.env.URL ?? 'http://localhost:4173/');
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/m01-title.png` });
await page.getByText('Clock in').tap();
await page.waitForTimeout(2500);
const touch = await page.evaluate(() => !!window.icooked.touch);
console.log('touch UI', touch);
// Joystick: press left, drag up (forward), hold, release.
const before = await page.evaluate(() => ({ ...window.icooked.player.pos }));
await page.evaluate(() => {
  const z = document.querySelector('.touch-zone');
  const ev = (type, x, y) => z.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, bubbles: true }));
  ev('pointerdown', 120, 280);
  ev('pointermove', 120, 220);
  window.__ev = ev;
});
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/m02-walking.png` });
await page.evaluate(() => window.__ev('pointerup', 120, 220));
const after = await page.evaluate(() => ({ ...window.icooked.player.pos }));
console.log('moved', Math.hypot(after.x - before.x, after.z - before.z).toFixed(2), 'm');
// Look: drag on right side
const yaw0 = await page.evaluate(() => window.icooked.player.yaw);
await page.evaluate(() => {
  const z = document.querySelector('.touch-zone');
  const ev = (type, x) => z.dispatchEvent(new PointerEvent(type, { pointerId: 8, pointerType: 'touch', clientX: x, clientY: 200, bubbles: true }));
  ev('pointerdown', 600); ev('pointermove', 500); ev('pointerup', 500);
});
console.log('yaw change', (await page.evaluate(() => window.icooked.player.yaw) - yaw0).toFixed(2));
// Walk to the PX-9 and tap USE
await page.evaluate(() => { const a = window.icooked; const s = a.stations.get('px9'); a.player.pos.set(s.spot.at.x, 0, s.spot.at.z); a.player.faceTowards(s.spot.viewLook); });
await page.waitForTimeout(1500);
console.log('use label', await page.locator('.tbtn.use').textContent());
await page.locator('.tbtn.use').dispatchEvent('pointerdown');
await page.waitForFunction(() => window.icooked.active?.root.isConnected, null, { timeout: 30000 });
await page.waitForTimeout(1000);
await page.screenshot({ path: `${out}/m03-px9.png` });
await page.locator('.station-bar button', { hasText: 'Leave' }).tap();
await page.waitForFunction(() => !window.icooked.player.parked, null, { timeout: 30000 });
await page.evaluate(() => { const a = window.icooked; const s = a.stations.get('desk'); a.player.pos.set(s.spot.at.x, 0, s.spot.at.z); a.player.faceTowards(s.spot.viewLook); });
await page.waitForTimeout(1500);
await page.locator('.tbtn.use').dispatchEvent('pointerdown');
await page.waitForFunction(() => window.icooked.active?.root.isConnected, null, { timeout: 30000 });
await page.waitForTimeout(1000);
await page.screenshot({ path: `${out}/m04-desk.png` });
console.log(errors.join('\n') || 'no page errors');
await browser.close();
