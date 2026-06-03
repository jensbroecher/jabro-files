import { BrowserWindow as e, app as t, dialog as n, ipcMain as r, shell as i } from "electron";
import a from "node:path";
import o from "node:fs/promises";
import { exec as s } from "node:child_process";
import { promisify as c } from "node:util";
import { fileURLToPath as l } from "node:url";
//#region electron/main.ts
var u = c(s), d = l(import.meta.url), f = a.dirname(d);
function p() {
	return t.isPackaged ? a.join(process.resourcesPath, "app.asar", "dist-electron", "preload.js") : a.join(f, "preload.js");
}
function m() {
	return t.isPackaged ? a.join(process.resourcesPath, "app.asar", "dist", "index.html") : a.join(f, "../dist/index.html");
}
var h = null;
function g() {
	h = new e({
		width: 1180,
		height: 780,
		minWidth: 820,
		minHeight: 520,
		backgroundColor: "#0f0f10",
		title: "JabroFiles",
		titleBarStyle: "hidden",
		titleBarOverlay: {
			color: "#18181b",
			symbolColor: "#a1a1aa",
			height: 40
		},
		webPreferences: {
			preload: p(),
			contextIsolation: !0,
			nodeIntegration: !1
		}
	});
	let t = process.env.VITE_DEV_SERVER_URL;
	t ? h.loadURL(t) : h.loadFile(m()), h.on("closed", () => {
		h = null;
	});
}
t.whenReady().then(() => {
	g(), t.on("activate", () => {
		e.getAllWindows().length === 0 && g();
	});
}), t.on("window-all-closed", () => {
	process.platform !== "darwin" && t.quit();
}), r.handle("list-directory", async (e, t) => {
	try {
		let e = await o.readdir(t, { withFileTypes: !0 }), n = [];
		for (let r of e) {
			let e = a.join(t, r.name), i = r.isDirectory(), s = i ? void 0 : a.extname(r.name).toLowerCase() || void 0, c = (/* @__PURE__ */ new Date()).toISOString(), l;
			try {
				let t = await o.stat(e);
				c = t.mtime.toISOString(), i || (l = t.size);
			} catch {
				i || (l = 0);
			}
			n.push({
				name: r.name,
				path: e,
				isDirectory: i,
				mtime: c,
				ext: s,
				size: i ? void 0 : l
			});
		}
		return n.sort((e, t) => e.isDirectory === t.isDirectory ? e.name.localeCompare(t.name, void 0, { sensitivity: "base" }) : e.isDirectory ? -1 : 1), n;
	} catch (e) {
		return console.error("list-directory error", t, e), [];
	}
});
async function _(e, t = 12) {
	let n = 0, r = 0, i = 0, s = [e], c = [], l = async () => {
		for (; s.length > 0;) {
			let t = s.shift();
			if (!t) break;
			let c;
			try {
				c = await o.readdir(t, { withFileTypes: !0 });
			} catch {
				continue;
			}
			t !== e && i++;
			for (let e of c) {
				let i = a.join(t, e.name);
				if (e.isDirectory()) s.push(i);
				else if (e.isFile()) try {
					let e = await o.stat(i);
					n += e.size, r++;
				} catch {}
			}
		}
	};
	for (let e = 0; e < t; e++) c.push(l());
	return await Promise.all(c), {
		size: n,
		fileCount: r,
		dirCount: i
	};
}
r.handle("get-folder-size", async (e, t) => {
	try {
		return await _(t);
	} catch (e) {
		return console.error("get-folder-size failed", t, e), {
			size: 0,
			fileCount: 0,
			dirCount: 0
		};
	}
});
async function v(e, t) {
	if ((await o.stat(e)).isDirectory()) {
		await o.mkdir(t, { recursive: !0 });
		let n = await o.readdir(e);
		for (let r of n) await v(a.join(e, r), a.join(t, r));
	} else await o.copyFile(e, t);
}
async function y(e) {
	if ((await o.stat(e)).isDirectory()) {
		let t = await o.readdir(e);
		for (let n of t) await y(a.join(e, n));
		await o.rmdir(e);
	} else await o.unlink(e);
}
r.handle("copy-files", async (e, { sources: t, target: n }) => {
	for (let e of t) {
		let t = a.basename(e), r = a.join(n, t), i = 1;
		for (;;) try {
			await o.access(r);
			let e = a.parse(t);
			r = a.join(n, `${e.name} (${i})${e.ext}`), i++;
		} catch {
			break;
		}
		await v(e, r);
	}
}), r.handle("move-files", async (e, { sources: t, target: n }) => {
	for (let e of t) {
		let t = a.basename(e), r = a.join(n, t), i = 1;
		for (;;) try {
			await o.access(r);
			let e = a.parse(t);
			r = a.join(n, `${e.name} (${i})${e.ext}`), i++;
		} catch {
			break;
		}
		try {
			await o.rename(e, r);
		} catch {
			await v(e, r), await y(e);
		}
	}
}), r.handle("select-folder", async () => {
	if (!h) return null;
	let e = await n.showOpenDialog(h, {
		properties: ["openDirectory", "createDirectory"],
		title: "Open folder"
	});
	return e.canceled || e.filePaths.length === 0 ? null : e.filePaths[0];
}), r.handle("open-path", async (e, t) => {
	await i.openPath(t);
}), r.handle("show-in-explorer", async (e, t) => {
	i.showItemInFolder(t);
}), r.handle("get-drives", async () => {
	if (process.platform !== "win32") return [{
		name: "/",
		path: "/"
	}];
	try {
		let { stdout: e } = await u("powershell -NoProfile -Command \"Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID, VolumeName, Size, FreeSpace | ConvertTo-Json -AsArray\""), t = JSON.parse(e || "[]");
		return (Array.isArray(t) ? t : [t]).filter((e) => e.DeviceID).map((e) => ({
			name: e.DeviceID,
			path: e.DeviceID + "\\",
			label: e.VolumeName || void 0
		}));
	} catch {
		let e = [
			"C:\\",
			"D:\\",
			"E:\\",
			"F:\\",
			"G:\\",
			"H:\\"
		], t = [];
		for (let n of e) try {
			await o.access(n), t.push({
				name: n[0] + ":",
				path: n
			});
		} catch {}
		return t.length ? t : [{
			name: "C:",
			path: "C:\\"
		}];
	}
});
//#endregion
