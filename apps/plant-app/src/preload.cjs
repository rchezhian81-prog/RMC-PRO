const { contextBridge, ipcRenderer } = require('electron');

/** Safe bridge exposing sync actions to the renderer (Design Doc 11 §10). */
contextBridge.exposeInMainWorld('rmc', {
  auth: (baseUrl, token) => ipcRenderer.invoke('sync:auth', { baseUrl, token }),
  register: (dto) => ipcRenderer.invoke('sync:register', dto),
  reserve: (documentType, count) => ipcRenderer.invoke('sync:reserve', { documentType, count }),
  createChallan: (dto) => ipcRenderer.invoke('sync:challan', dto),
  createBatch: (dto) => ipcRenderer.invoke('sync:batch', dto),
  push: () => ipcRenderer.invoke('sync:push'),
  pull: () => ipcRenderer.invoke('sync:pull'),
  status: () => ipcRenderer.invoke('sync:status'),
});
