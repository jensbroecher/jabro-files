const { app, BrowserWindow } = require('electron');
const path = require('path');
const url = require('url');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.resolve('dist-electron/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.webContents.on('console-message', (_e, level, msg) => {
    console.log('[CONSOLE]', msg);
  });

  await win.loadURL(url.pathToFileURL(path.resolve('dist/index.html')).toString());

  // Wait 6 seconds to observe initial folder load and background workers
  setTimeout(() => {
    app.quit();
  }, 6000);
});
