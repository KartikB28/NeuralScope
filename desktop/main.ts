/**
 * The desktop shell. Electron's only jobs: boot the Engine in-process, open a
 * window onto the World, and expose two safe OS affordances (open folder /
 * open link). All real behavior lives in the Engine — the shell is thin on
 * purpose, and the same Engine runs headless via `npm run engine`.
 */
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';

let stopEngine: (() => Promise<void>) | null = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

async function boot(): Promise<void> {
  const packaged = app.isPackaged;
  const resources = packaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked')
    : path.join(__dirname, '..', '..');

  // engine bundle sits next to this file in dist/
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { startEngine } = require(path.join(__dirname, '..', 'engine', 'index.cjs'));

  const running = await startEngine({
    bundledDefinitions: path.join(resources, 'definitions'),
    worldDist: packaged
      ? path.join(process.resourcesPath, 'app.asar', 'world', 'dist')
      : path.join(resources, 'world', 'dist'),
  });
  stopEngine = running.stop;

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#060b12',
    title: 'NeuralScope',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // external links open in the user's browser, never inside the world
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`http://127.0.0.1:${running.port}`)) return { action: 'allow' };
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  // headless visual check (CI / debugging): NEURALSCOPE_SCREENSHOT=/out.png
  // armed before loadURL so a slow software-GL load can't starve it
  const shot = process.env.NEURALSCOPE_SCREENSHOT;
  if (shot) {
    const delay = Number(process.env.NEURALSCOPE_SCREENSHOT_DELAY ?? 12_000);
    if (process.env.NEURALSCOPE_SCREENSHOT_SKIP_ONBOARD === '1') {
      win.webContents.once('did-finish-load', () => {
        void win.webContents.executeJavaScript(
          `if(localStorage.getItem('ns.onboarded')!=='1'){localStorage.setItem('ns.onboarded','1');location.reload();}`);
      });
    }
    const tryCapture = async (attempt: number): Promise<void> => {
      try {
        const img = await win.webContents.capturePage();
        const png = img.toPNG();
        if (png.length > 8_000 || attempt >= 5) {
          fs.writeFileSync(shot, png);
          console.log(`screenshot → ${shot} (${png.length} bytes, attempt ${attempt})`);
          return;
        }
      } catch (ex) { console.error(`screenshot attempt ${attempt} failed:`, ex); }
      if (attempt < 5) setTimeout(() => void tryCapture(attempt + 1), 4000);
    };
    setTimeout(() => void tryCapture(1), delay);
  }

  await win.loadURL(`http://127.0.0.1:${running.port}`);
  console.log('world loaded');
}

ipcMain.handle('ns:openPath', async (_e, p: string) => {
  if (typeof p === 'string' && p.length > 0) await shell.openPath(p);
});
ipcMain.handle('ns:openExternal', async (_e, u: string) => {
  if (typeof u === 'string' && /^https?:\/\//.test(u)) await shell.openExternal(u);
});

app.whenReady().then(boot).catch((ex) => {
  console.error('failed to start NeuralScope:', ex);
  app.quit();
});

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.on('window-all-closed', () => {
  void (async () => {
    if (stopEngine) await stopEngine().catch(() => {});
    app.quit();
  })();
});
