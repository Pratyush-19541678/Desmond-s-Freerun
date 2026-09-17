// Desmon Run — Electron entry point (Windows .exe).
// Serves the bundled game over the `app://` protocol so ES modules and
// .gltf / .bin / .glb / texture fetches work with no server and no network.
const { app, BrowserWindow, protocol } = require('electron');
const path = require('path');
const fs = require('fs');

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.gltf': 'model/gltf+json',
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain',
  '.md': 'text/plain',
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function fileResponse(url) {
  try {
    const u = new URL(url);
    // NOTE: in app:///game/index.html the URL parser puts "game" in .host,
    // so the real path is host + pathname.
    let rel = (u.host ? u.host + u.pathname : u.pathname) || '/';
    rel = decodeURIComponent(rel);
    if (rel.endsWith('/')) rel += 'index.html';
    // Browsers resolve "../x" from "app://game/index.html" to "app://game/x"
    // (a non-special scheme host can't be escaped with ".."), while the game
    // means the app root. So fall back to the root-relative path on a miss.
    const candidates = [rel];
    if (rel.startsWith('game/')) candidates.push(rel.slice('game/'.length));
    let full = null;
    for (const cand of candidates) {
      const attempt = path.normalize(path.join(__dirname, cand));
      if (attempt !== __dirname && !attempt.startsWith(__dirname + path.sep)) {
        return new Response('forbidden', { status: 403 });
      }
      if (fs.existsSync(attempt) && !fs.statSync(attempt).isDirectory()) {
        full = attempt;
        rel = cand;
        break;
      }
    }
    if (!full) {
      return new Response('not found: ' + rel, { status: 404 });
    }
    const ext = path.extname(full).toLowerCase();
    const data = fs.readFileSync(full);
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    return new Response(String(e), { status: 500 });
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Desmon Run — Parkour Through Monteriggioni',
    backgroundColor: '#0b0e13',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL('app:///game/index.html');
  // TEMP-DEBUG (removed after test)
  try {
    const dbgPath = path.join(__dirname, 'webconsole-debug.log');
    fs.writeFileSync(dbgPath, '--- session start ---\n');
    win.webContents.on('console-message', (e, level, msg) => {
      fs.appendFileSync(dbgPath, `[${level}] ${String(msg).slice(0, 300)}\n`);
    });
  } catch (e) {}
  // TEMP-DEBUG (removed after test)
  try {
    const dbgPath = path.join(__dirname, 'webconsole-debug.log');
    fs.writeFileSync(dbgPath, '--- session start ---\n');
    win.webContents.on('console-message', (e, level, msg) => {
      fs.appendFileSync(dbgPath, `[${level}] ${String(msg).slice(0, 300)}\n`);
    });
  } catch (e) {}
  // TEMP-DEBUG (removed after test)
  try {
    const dbgPath = path.join(__dirname, 'webconsole-debug.log');
    fs.writeFileSync(dbgPath, '--- session start ---\n');
    win.webContents.on('console-message', (e, level, msg) => {
      fs.appendFileSync(dbgPath, `[${level}] ${String(msg).slice(0, 300)}\n`);
    });
  } catch (e) {}
  // TEMP-DEBUG (removed after test)
  try {
    const dbgPath = path.join(__dirname, 'webconsole-debug.log');
    fs.writeFileSync(dbgPath, '--- session start ---\n');
    win.webContents.on('console-message', (e, level, msg) => {
      fs.appendFileSync(dbgPath, `[${level}] ${String(msg).slice(0, 300)}\n`);
    });
  } catch (e) {}
  // Uncomment to debug the packaged game:
  // win.webContents.openDevTools();
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => fileResponse(req.url));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
