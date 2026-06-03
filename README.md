# JabroFiles

Fast local file browser for Windows with **recursive folder sizes** shown directly in the listing — no need to open folders to see how big they are.

Built with Electron + React + Tailwind. Runs great on Windows 11.

## Features

- Browse any folder on your drives (real native access)
- See total size of every subfolder (all files inside, recursively) without entering it
- Click any folder's size cell to (re)calculate on demand
- "Calc sizes in view" button + optional Auto-calc when entering directories
- Sort by size, name, or date
- Filter / search in current folder
- Keyboard: Backspace = up, F5 = refresh, Ctrl+R = calculate all visible, arrows + Enter
- Context menu (right click): Open, Show in Explorer, Copy path, Calculate size
- Native folder picker + "Open in Explorer"
- Sidebar with quick access + detected drives
- Efficient size walker (limited concurrency, async)

## How to run

**Easiest (double-click):**

- Double-click `JabroFiles.bat` in this folder.

**From terminal:**

```powershell
cd H:\AppDev\size-browser
npm install          # first time only
npm start
```

Or simply:

```powershell
cd H:\AppDev\size-browser
npx electron .
```

This launches the real desktop app with full access to your drives and the recursive folder size feature.

For fast UI development (browser preview with mock data + hot reload):

```powershell
npm run dev
```

Then open http://localhost:5173 in a browser.

## First time tips

- Click the folder icon (top right) or the "Open folder…" button to browse any folder.
- In the list, **click the Size column** on any subfolder row to calculate its total size (all files inside, recursively).
- Use **Ctrl + R** or the calculator button to scan sizes for everything visible in the current folder.
- The "Auto" button toggles whether it starts calculating sizes automatically when you enter a directory.
- Right-click rows for context menu (Show in Explorer, Copy path, etc.).
- Large folders (e.g. node_modules, game installs) can take a few seconds the first time — this is expected. The UI stays responsive.

## Build a distributable

```powershell
npm run electron:build
```

Outputs to `release/` folder:
- Portable `.exe` (single file, no install)
- NSIS installer `.exe`

## How folder sizes work

- Listing a directory is always fast (just `readdir` + `stat` of direct children)
- Folder sizes are computed on demand in a background worker-style (Node main process)
- Results are cached in memory for the session
- The walker uses controlled concurrency (avoids killing your disk on huge trees like node_modules)
- You can force recalc any time by clicking the size value of a folder row

## Notes / Tips

- Very large folders (hundreds of thousands of files) will take time the first time — this is normal. The UI stays responsive.
- Sizes shown are logical file sizes (not "size on disk").
- Symlinks are skipped to avoid double-counting / infinite loops.
- For best experience, start from a high level folder and drill down (or use the calculate buttons).

## Tech

- Vite + React 19 + TypeScript + Tailwind v4
- Electron 31
- electron-builder for packaging
- Custom recursive size implementation (no heavy deps)

Created for local use on Windows 11.
