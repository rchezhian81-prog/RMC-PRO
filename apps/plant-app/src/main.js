import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SyncEngine } from './sync/engine.js';

/**
 * Electron main process for the standalone plant app (Design Doc 7 §Plant App).
 * Owns the local SQLite via the SyncEngine and exposes sync actions to the
 * renderer over IPC. Offline-first: all entry works without a network; sync
 * runs when online.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(app?.getPath ? app.getPath('userData') : '.', 'rmc-plant.sqlite');
const engine = new SyncEngine({ dbPath: DB_PATH });

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// IPC bridge → sync engine.
ipcMain.handle('sync:auth', (_e, { baseUrl, token }) => { engine.setAuth(baseUrl, token); return { ok: true }; });
ipcMain.handle('sync:register', (_e, dto) => engine.registerAndBootstrap(dto));
ipcMain.handle('sync:reserve', (_e, { documentType, count }) => engine.reserve(documentType, count));
ipcMain.handle('sync:challan', (_e, dto) => engine.createOfflineChallan(dto));
ipcMain.handle('sync:batch', (_e, dto) => engine.createOfflineBatch(dto));
ipcMain.handle('sync:push', () => engine.pushPending());
ipcMain.handle('sync:pull', () => engine.pull());
ipcMain.handle('sync:status', () => ({ pending: engine.pendingCount(), deviceId: engine.deviceId, token: engine.getMeta('sync_token') }));

app?.whenReady?.().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app?.on?.('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
