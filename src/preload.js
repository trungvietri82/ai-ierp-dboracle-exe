'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Exposed to the loaded web app. The web app can detect `window.aiierp` to enable
// desktop-only features (local file/shell tools) when running in the desktop.
contextBridge.exposeInMainWorld('aiierp', {
  isDesktop: true,
  platform: process.platform,
  setup: {
    get: () => ipcRenderer.invoke('setup:get'),
    save: (url) => ipcRenderer.invoke('setup:save', url),
  },
  localTools: {
    readFile: (p) => ipcRenderer.invoke('local:readFile', p),
    writeFile: (p, data) => ipcRenderer.invoke('local:writeFile', p, data),
    listDir: (p) => ipcRenderer.invoke('local:listDir', p),
    exec: (cmd) => ipcRenderer.invoke('local:exec', cmd),
  },
});
