// Desktop shell for the Steam build. Serves the Vite build from dist/ over a
// private app:// scheme (ES modules don't load from file://).
// Steamworks (achievements, leaderboards) is wired in at M10 via steamworks.js.
const { app, BrowserWindow, Menu, net, protocol } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const smoke = process.argv.includes('--smoke-test');
const DIST = path.join(__dirname, '..', 'dist');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    backgroundColor: '#0e1012',
    title: 'ICooked',
    show: !smoke,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  win.loadURL('app://game/index.html');
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen());
  });
  if (smoke) {
    win.webContents.on('console-message', (e) => console.log('[renderer]', e.message ?? e));
    win.webContents.on('did-fail-load', (_e, code, desc, url) => console.log('[load failed]', code, desc, url));
    win.webContents.on('did-finish-load', () => {
      setTimeout(async () => {
        const ok = await win.webContents.executeJavaScript('typeof window.icooked === "object"');
        console.log(ok ? 'SMOKE OK' : 'SMOKE FAIL');
        app.exit(ok ? 0 : 1);
      }, 3000);
    });
  }
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (!file.startsWith(DIST)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
});
app.on('window-all-closed', () => app.quit());
