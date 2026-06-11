'use strict';
const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { exec } = require('node:child_process');

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}
function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

let win;

function loadApp() {
  const cfg = readConfig();
  const url = cfg.backendUrl || process.env.AIIERP_BACKEND; // env override (CI / kiosk)
  if (!url) {
    win.loadFile(path.join(__dirname, 'setup.html'));
  } else {
    win.loadURL(url).catch(() => win.loadFile(path.join(__dirname, 'setup.html')));
  }
}

function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'AI iERP',
        submenu: [
          { label: 'Cấu hình server…', click: () => win.loadFile(path.join(__dirname, 'setup.html')) },
          { label: 'Tải lại', accelerator: 'CmdOrCtrl+R', click: () => loadApp() },
          { type: 'separator' },
          { role: 'quit', label: 'Thoát' },
        ],
      },
      { label: 'Xem', submenu: [{ role: 'toggleDevTools' }, { role: 'togglefullscreen' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
    ])
  );
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'AI iERP',
    icon: path.join(__dirname, '..', 'resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  buildMenu();
  loadApp();

  win.webContents.on('did-finish-load', () => {
    console.log('[loaded]', win.webContents.getURL());
    if (process.env.AIIERP_SMOKE) setTimeout(() => app.quit(), 1500); // headless verify
  });
}

// ---- setup (backend URL) ----
ipcMain.handle('setup:get', () => readConfig().backendUrl || '');
ipcMain.handle('setup:save', (_e, raw) => {
  const url = String(raw || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(url)) return { ok: false, error: 'URL phải bắt đầu bằng http:// hoặc https://' };
  const cfg = readConfig();
  cfg.backendUrl = url;
  writeConfig(cfg);
  win.loadURL(url).catch(() => {});
  return { ok: true };
});

// ---- local tools (the desktop's local capability; exposed to the renderer) ----
ipcMain.handle('local:readFile', (_e, p) => fs.promises.readFile(p, 'utf8'));
ipcMain.handle('local:writeFile', (_e, p, data) => fs.promises.writeFile(p, data));
ipcMain.handle('local:listDir', (_e, p) =>
  fs.promises.readdir(p, { withFileTypes: true }).then((es) => es.map((e) => ({ name: e.name, dir: e.isDirectory() })))
);
ipcMain.handle('local:exec', (_e, cmd) =>
  new Promise((resolve) => {
    exec(String(cmd), { timeout: 60000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) =>
      resolve({ code: err ? err.code ?? 1 : 0, stdout, stderr })
    );
  })
);

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
