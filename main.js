// main.js — Electron main process voor "PC Cleanup App"
// Verantwoordelijk voor het aanmaken van het venster en alle native acties
// (map kiezen, mappen scannen, bestanden openen, bestanden naar de prullenbak).
// Alle native acties lopen via ipcMain om Windows-beveiligingsfouten te voorkomen.

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Bestandstypen voor de "Snel & Veilig"-scan
const SAFE_EXTENSIONS = [
  '.jpg', '.png', '.jpeg', '.mp4', '.pdf',
  '.docx', '.xlsx', '.csv', '.txt', '.ai'
];

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 880,
    minWidth: 560,
    minHeight: 640,
    backgroundColor: '#f0f2f5',
    title: 'PC Cleanup App',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      // nodeIntegration + contextIsolation:false zodat de renderer (index.html)
      // direct require('fs'), require('xlsx') en ipcRenderer kan gebruiken voor previews.
      nodeIntegration: true,
      contextIsolation: false,
      spellcheck: false
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadFile('index.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------------------------------------------------------------------------
// IPC: snelle paden teruggeven (Downloads, Bureaublad, Documenten)
// ---------------------------------------------------------------------------
ipcMain.handle('get-quick-paths', () => {
  const home = os.homedir();
  return {
    downloads: path.join(home, 'Downloads'),
    desktop: path.join(home, 'Desktop'),
    documents: path.join(home, 'Documents')
  };
});

// ---------------------------------------------------------------------------
// IPC: native Windows mappenkiezer
// ---------------------------------------------------------------------------
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Kies een map om op te ruimen',
    properties: ['openDirectory']
  });

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

// ---------------------------------------------------------------------------
// IPC: een map scannen
//   folderPath: het pad
//   deepClean:  true  -> alle bestanden (stats.isFile())
//               false -> alleen veilige extensies
// Geeft een array van { path, name, size, mtimeMs, ext } terug.
// ---------------------------------------------------------------------------
ipcMain.handle('scan-folder', async (event, folderPath, deepClean) => {
  const files = [];

  let entries;
  try {
    entries = fs.readdirSync(folderPath);
  } catch (err) {
    return { error: 'Kan de map niet lezen: ' + err.message, files: [] };
  }

  for (const entry of entries) {
    const fullPath = path.join(folderPath, entry);
    let stats;
    try {
      stats = fs.statSync(fullPath);
    } catch (err) {
      // Bestand niet leesbaar (rechten/in gebruik) -> overslaan
      continue;
    }

    if (!stats.isFile()) continue;

    const ext = path.extname(entry).toLowerCase();

    if (!deepClean && !SAFE_EXTENSIONS.includes(ext)) {
      continue;
    }

    files.push({
      path: fullPath,
      name: entry,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      ext: ext
    });
  }

  return { error: null, files };
});

// ---------------------------------------------------------------------------
// IPC: bestand native openen
// ---------------------------------------------------------------------------
ipcMain.handle('open-path', async (event, filePath) => {
  // shell.openPath geeft een lege string terug bij succes, anders een foutmelding
  const result = await shell.openPath(filePath);
  return { error: result || null };
});

// ---------------------------------------------------------------------------
// IPC: bestanden naar de Windows Prullenbak verplaatsen
//   paths: array van bestandspaden
// Loopt over de paden, gebruikt shell.trashItem() en vangt fouten op.
// Geeft terug: { successCount, errors: [{ path, name, message }] }
// ---------------------------------------------------------------------------
ipcMain.handle('trash-items', async (event, paths) => {
  let successCount = 0;
  const errors = [];

  for (const filePath of paths) {
    try {
      await shell.trashItem(filePath);
      successCount++;
    } catch (err) {
      // Specifieke Windows-foutmelding teruggeven (bv. bestand in gebruik
      // of op een netwerkschijf die de prullenbak niet ondersteunt).
      errors.push({
        path: filePath,
        name: path.basename(filePath),
        message: err && err.message ? err.message : String(err)
      });
    }
  }

  return { successCount, errors };
});
