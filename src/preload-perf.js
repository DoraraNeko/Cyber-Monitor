// Performance Monitor 用（renderer/perf）。元の Performance Monitor と同じ API
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hud', {
  on: (channel, cb) => {
    if (!['init', 'metrics', 'claude'].includes(channel)) return;
    ipcRenderer.on(channel, (_e, data) => cb(data));
  },
});

// 壁紙の上の猫（renderer/cat/cat.js）
contextBridge.exposeInMainWorld('catHost', {
  send: (channel, data) => { if (['cat:ready', 'cat:spots'].includes(channel)) ipcRenderer.send(channel, data); },
  on: (cb) => ipcRenderer.on('cat', (_e, msg) => cb(msg)),
});
