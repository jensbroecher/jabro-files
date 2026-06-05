import { BrowserWindow as e, app as t, dialog as n, ipcMain as r, shell as i } from "electron";
import a from "node:path";
import o from "node:fs/promises";
import * as s from "node:fs";
import { exec as c, spawn as l } from "node:child_process";
import { promisify as u } from "node:util";
import { fileURLToPath as d } from "node:url";
//#region electron/main.ts
var f = u(c), p = d(import.meta.url), m = a.dirname(p);
function h() {
	return t.isPackaged ? a.join(process.resourcesPath, "app.asar", "dist-electron", "preload.js") : a.join(m, "preload.js");
}
function g() {
	return t.isPackaged ? a.join(process.resourcesPath, "app.asar", "dist", "index.html") : a.join(m, "../dist/index.html");
}
var _ = null, v = () => a.join(t.getPath("userData"), "window-bounds.json");
function y() {
	try {
		if (s.existsSync(v())) {
			let e = s.readFileSync(v(), "utf8");
			return JSON.parse(e);
		}
	} catch {}
	return null;
}
function b(e) {
	try {
		let t = e.getBounds();
		t.isMaximized = e.isMaximized(), s.writeFileSync(v(), JSON.stringify(t));
	} catch {}
}
function x() {
	let t = y(), n = {
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
			preload: h(),
			contextIsolation: !0,
			nodeIntegration: !1
		}
	};
	t && (n.x = t.x, n.y = t.y, n.width = t.width, n.height = t.height), _ = new e(n), t && t.isMaximized && _.maximize();
	let r = process.env.VITE_DEV_SERVER_URL;
	r ? _.loadURL(r) : _.loadFile(g()), _.on("moved", () => b(_)), _.on("resized", () => b(_)), _.on("close", () => b(_)), _.on("closed", () => {
		_ = null;
	});
}
t.whenReady().then(() => {
	x(), t.on("activate", () => {
		e.getAllWindows().length === 0 && x();
	});
}), t.on("window-all-closed", () => {
	process.platform !== "darwin" && t.quit();
}), r.handle("list-directory", async (e, t) => {
	try {
		let e = await o.readdir(t, { withFileTypes: !0 }), n = [];
		for (let r of e) {
			if (r.name.startsWith("._")) continue;
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
async function S(e, t = 12) {
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
				if (e.name.startsWith("._")) continue;
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
		return await S(t);
	} catch (e) {
		return console.error("get-folder-size failed", t, e), {
			size: 0,
			fileCount: 0,
			dirCount: 0
		};
	}
});
async function C(e, t) {
	if ((await o.stat(e)).isDirectory()) {
		if (process.platform === "win32") return new Promise((n, r) => {
			let i = l("robocopy", [
				e,
				t,
				"/E",
				"/COPY:DAT",
				"/R:1",
				"/W:1",
				"/MT:8",
				"/IS"
			], { windowsVerbatimArguments: !0 });
			i.stdout.on("data", (e) => {
				let t = e.toString().trim();
				t && _ && _.webContents.send("copy-progress", { line: t.substring(0, 120) });
			}), i.on("close", (t) => {
				t > 7 ? r(/* @__PURE__ */ Error(`robocopy failed with code ${t}`)) : (_ && _.webContents.send("copy-progress", { line: `Finished copying folder: ${a.basename(e)}` }), n());
			}), i.on("error", r);
		});
		{
			await o.mkdir(t, { recursive: !0 });
			let n = await o.readdir(e);
			for (let r of n) await C(a.join(e, r), a.join(t, r));
		}
	} else await o.copyFile(e, t), _ && _.webContents.send("copy-progress", { line: `Copied file: ${a.basename(t)}` });
}
async function w(e) {
	if ((await o.stat(e)).isDirectory()) {
		let t = await o.readdir(e);
		for (let n of t) await w(a.join(e, n));
		await o.rmdir(e);
	} else await o.unlink(e);
}
async function T(e) {
	let t = "New folder", n = t, r = a.join(e, n), i = 1;
	for (;;) try {
		await o.access(r), n = `${t} (${i})`, r = a.join(e, n), i++;
	} catch {
		break;
	}
	return await o.mkdir(r), r;
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
		await C(e, r);
	}
	_ && _.webContents.send("copy-progress", { line: "Copy complete." });
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
			await C(e, r), await w(e);
		}
	}
	_ && _.webContents.send("copy-progress", { line: "Move complete." });
}), r.handle("create-folder", async (e, t) => {
	try {
		return await T(t);
	} catch (e) {
		throw console.error("create-folder failed for", t, e), e;
	}
}), r.handle("select-folder", async () => {
	if (!_) return null;
	let e = await n.showOpenDialog(_, {
		properties: ["openDirectory", "createDirectory"],
		title: "Open folder"
	});
	return e.canceled || e.filePaths.length === 0 ? null : e.filePaths[0];
}), r.handle("open-path", async (e, t) => {
	await i.openPath(t);
}), r.handle("show-in-explorer", async (e, t) => {
	i.showItemInFolder(t);
}), r.handle("read-text-file", async (e, t) => {
	try {
		return (await o.stat(t)).size > 1024 * 1024 ? "[File too large to preview as text. Use \"Open with default app\".]" : await o.readFile(t, "utf8");
	} catch {
		return "[Unable to read file as text.]";
	}
}), r.handle("open-terminal", async (e, t, n = "cmd") => {
	try {
		let e = t.replace(/"/g, "\\\""), r;
		r = n === "powershell" ? `start powershell -NoExit -Command "Set-Location -LiteralPath '${e}'"` : `start cmd /K "cd /D \\"${e}\\""`, await f(r, { cwd: t });
	} catch (e) {
		console.error("Failed to open terminal", e);
	}
}), r.handle("get-drives", async () => {
	if (process.platform !== "win32") return [{
		name: "/",
		path: "/"
	}];
	try {
		let { stdout: e } = await f("powershell -NoProfile -Command \"[System.IO.DriveInfo]::GetDrives() | Where-Object { $_.IsReady } | Select-Object Name, VolumeLabel, TotalSize, AvailableFreeSpace | ConvertTo-Json -AsArray\""), t = JSON.parse(e || "[]");
		return (Array.isArray(t) ? t : [t]).filter((e) => e.Name).map((e) => ({
			name: e.Name.replace(/\\$/, ""),
			path: e.Name.endsWith("\\") ? e.Name : e.Name + "\\",
			label: e.VolumeLabel || void 0,
			size: e.TotalSize ? Number(e.TotalSize) : void 0,
			freeSpace: e.AvailableFreeSpace ? Number(e.AvailableFreeSpace) : void 0
		}));
	} catch {
		try {
			let { stdout: e } = await f("wmic logicaldisk get name,size,freespace /format:csv"), t = e.trim().split(/\r?\n/).filter(Boolean), n = [];
			for (let e = 1; e < t.length; e++) {
				let r = t[e].split(",").map((e) => e.trim());
				if (r.length < 4) continue;
				let i = r[1], a = r[2], o = r[3];
				a && /^[A-Za-z]:/.test(a) && n.push({
					name: a.replace(/\\$/, ""),
					path: a.endsWith("\\") ? a : a + "\\",
					size: o && /^\d+$/.test(o) ? Number(o) : void 0,
					freeSpace: i && /^\d+$/.test(i) ? Number(i) : void 0
				});
			}
			if (n.length) return n;
		} catch {}
		let e = [
			"C:\\",
			"D:\\",
			"E:\\",
			"F:\\",
			"G:\\",
			"H:\\"
		], t = [], n = {
			C: {
				s: 0xe8d4a51000,
				f: 3e11
			},
			D: {
				s: 5e11,
				f: 15e10
			},
			E: {
				s: 25e10,
				f: 8e10
			},
			F: {
				s: 12e10,
				f: 4e10
			},
			G: {
				s: 6e10,
				f: 2e10
			},
			H: {
				s: 4e11,
				f: 1e11
			}
		};
		for (let r of e) try {
			await o.access(r);
			let e = r[0], i = n[e] || {
				s: 1e11,
				f: 3e10
			};
			t.push({
				name: e + ":",
				path: r,
				size: i.s,
				freeSpace: i.f
			});
		} catch {}
		return t.length ? t : [{
			name: "C:",
			path: "C:\\",
			size: 0xe8d4a51000,
			freeSpace: 3e11
		}];
	}
}), r.handle("get-default-quick-access", async () => {
	try {
		return [
			{
				label: "Desktop",
				path: t.getPath("desktop")
			},
			{
				label: "Documents",
				path: t.getPath("documents")
			},
			{
				label: "Downloads",
				path: t.getPath("downloads")
			}
		];
	} catch (e) {
		return console.error("get-default-quick-access failed", e), [];
	}
});
//#endregion
