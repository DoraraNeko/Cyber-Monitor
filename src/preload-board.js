// Cyber Board 用（renderer/board）。元の Cyber Board と同じ API
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cyberBoard', {
  getState: () => ipcRenderer.invoke('state:get'),
  save: (tasks) => ipcRenderer.invoke('tasks:save', tasks),
  resizeTask: (height) => ipcRenderer.send('task:resize', height),
  on: (channel, cb) => {
    if (!['tasks', 'config'].includes(channel)) return;
    ipcRenderer.on(channel, (_e, data) => cb(data));
  },
});

// 壁紙の上の猫（renderer/cat/cat.js）
contextBridge.exposeInMainWorld('catHost', {
  send: (channel, data) => { if (['cat:ready', 'cat:spots'].includes(channel)) ipcRenderer.send(channel, data); },
  on: (cb) => ipcRenderer.on('cat', (_e, msg) => cb(msg)),
});
