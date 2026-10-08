import { BrowserWindow as e, app as t, dialog as n, ipcMain as r, protocol as i, session as a, shell as o } from "electron";
import s from "node:path";
import c from "node:fs/promises";
import * as l from "node:fs";
import { Readable as u } from "node:stream";
import d from "node:os";
import { exec as f, spawn as p } from "node:child_process";
import { promisify as m } from "node:util";
import { fileURLToPath as h } from "node:url";
//#region electron/main.ts
var g = m(f), _ = h(import.meta.url), v = s.dirname(_);
t.commandLine.appendSwitch("enable-features", "SharedArrayBuffer"), i.registerSchemesAsPrivileged([{
	scheme: "jabro-media",
	privileges: {
		standard: !0,
		secure: !0,
		supportFetchAPI: !0,
		corsEnabled: !0,
		stream: !0,
		bypassCSP: !0
	}
}]);
function y() {
	return t.isPackaged ? s.join(process.resourcesPath, "app.asar", "dist-electron", "preload.js") : s.join(v, "preload.js");
}
function b() {
	return t.isPackaged ? s.join(process.resourcesPath, "app.asar", "dist", "index.html") : s.join(v, "../dist/index.html");
}
var x = null, S = () => s.join(t.getPath("userData"), "window-bounds.json");
function C() {
	try {
		if (l.existsSync(S())) {
			let e = l.readFileSync(S(), "utf8");
			return JSON.parse(e);
		}
	} catch {}
	return null;
}
function w(e) {
	try {
		let t = e.getBounds();
		t.isMaximized = e.isMaximized(), l.writeFileSync(S(), JSON.stringify(t));
	} catch {}
}
function T() {
	let t = C(), n = {
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
			preload: y(),
			contextIsolation: !0,
			nodeIntegration: !1,
			plugins: !0
		}
	};
	t && (n.x = t.x, n.y = t.y, n.width = t.width, n.height = t.height), x = new e(n), t && t.isMaximized && x.maximize();
	let r = process.env.VITE_DEV_SERVER_URL;
	r ? x.loadURL(r) : x.loadFile(b()), x.webContents.on("console-message", (e, t, n, r, i) => {
		console.log(`[Renderer LOG ${t}] ${n} (${i}:${r})`);
	}), x.on("moved", () => w(x)), x.on("resized", () => w(x)), x.on("close", () => w(x)), x.on("closed", () => {
		x = null;
	});
}
t.whenReady().then(() => {
	a.defaultSession.webRequest.onHeadersReceived((e, t) => {
		t({ responseHeaders: {
			...e.responseHeaders,
			"Cross-Origin-Opener-Policy": ["same-origin"],
			"Cross-Origin-Embedder-Policy": ["require-corp"]
		} });
	}), i.handle("jabro-media", async (e) => {
		try {
			let t = new URL(e.url), n = t.searchParams.get("path");
			if (!n) {
				let e = decodeURIComponent(t.pathname);
				process.platform === "win32" && e.startsWith("/") && /^[a-zA-Z]:/.test(e.slice(1)) && (e = e.slice(1)), n = e;
			}
			let r = await c.stat(n), i = s.extname(n).toLowerCase(), a = new Headers(), o = "";
			i === ".pdf" ? o = "application/pdf" : i === ".glb" ? o = "model/gltf-binary" : i === ".gltf" ? o = "model/gltf+json" : i === ".obj" ? o = "text/plain" : (i === ".stl" || i === ".ply" || i === ".splat" || i === ".ksplat" || i === ".spz") && (o = "application/octet-stream"), o && a.set("content-type", o), a.set("access-control-allow-origin", "*"), a.set("access-control-expose-headers", "Content-Length, Content-Range, Accept-Ranges"), a.set("accept-ranges", "bytes"), a.set("Cross-Origin-Resource-Policy", "cross-origin");
			let d = e.headers.get("range"), f = 200, p;
			if (d) {
				let e = d.replace(/bytes=/, "").split("-"), t = parseInt(e[0], 10), i = e[1] ? parseInt(e[1], 10) : r.size - 1;
				if (!isNaN(t) && t < r.size) {
					let e = Math.min(i, r.size - 1), o = e - t + 1;
					a.set("content-length", o.toString()), a.set("content-range", `bytes ${t}-${e}/${r.size}`), f = 206, p = l.createReadStream(n, {
						start: t,
						end: e
					});
				} else a.set("content-length", r.size.toString()), p = l.createReadStream(n);
			} else a.set("content-length", r.size.toString()), p = l.createReadStream(n);
			let m = u.toWeb(p);
			return new Response(m, {
				status: f,
				headers: a
			});
		} catch (e) {
			return console.error("jabro-media protocol error:", e), new Response("File not found", { status: 404 });
		}
	}), r.handle("detect-ply-type", async (e, t) => {
		try {
			let e = await c.open(t, "r"), n = Buffer.alloc(4096), { bytesRead: r } = await e.read(n, 0, 4096, 0);
			await e.close();
			let i = n.toString("utf8", 0, r);
			return i.includes("f_dc_") || i.includes("opacity") || i.includes("scale_0") || i.includes("rot_0") || i.includes("packed_position") ? "gaussian-splat" : "3d";
		} catch (e) {
			return console.error("detect-ply-type error:", e), "3d";
		}
	}), T(), t.on("activate", () => {
		e.getAllWindows().length === 0 && T();
	});
}), t.on("window-all-closed", () => {
	process.platform !== "darwin" && t.quit();
}), r.handle("list-directory", async (e, t) => {
	try {
		let e = await c.readdir(t, { withFileTypes: !0 }), n = [];
		for (let r of e) {
			if (r.name.startsWith("._")) continue;
			let e = s.join(t, r.name), i = r.isDirectory(), a = i ? void 0 : s.extname(r.name).toLowerCase() || void 0, o = (/* @__PURE__ */ new Date()).toISOString(), l;
			try {
				let t = await c.stat(e);
				o = t.mtime.toISOString(), i || (l = t.size);
			} catch {
				i || (l = 0);
			}
			n.push({
				name: r.name,
				path: e,
				isDirectory: i,
				mtime: o,
				ext: a,
				size: i ? void 0 : l
			});
		}
		return n.sort((e, t) => e.isDirectory === t.isDirectory ? e.name.localeCompare(t.name, void 0, { sensitivity: "base" }) : e.isDirectory ? -1 : 1), n;
	} catch (e) {
		return console.error("list-directory error", t, e), [];
	}
});
async function E(e, t = 12) {
	let n = 0, r = 0, i = 0, a = [e], o = [], l = async () => {
		for (; a.length > 0;) {
			let t = a.shift();
			if (!t) break;
			let o;
			try {
				o = await c.readdir(t, { withFileTypes: !0 });
			} catch {
				continue;
			}
			t !== e && i++;
			for (let e of o) {
				if (e.name.startsWith("._")) continue;
				let i = s.join(t, e.name);
				if (e.isDirectory()) a.push(i);
				else if (e.isFile()) try {
					let e = await c.stat(i);
					n += e.size, r++;
				} catch {}
			}
		}
	};
	for (let e = 0; e < t; e++) o.push(l());
	return await Promise.all(o), {
		size: n,
		fileCount: r,
		dirCount: i
	};
}
r.handle("get-folder-size", async (e, t) => {
	try {
		return await E(t);
	} catch (e) {
		return console.error("get-folder-size failed", t, e), {
			size: 0,
			fileCount: 0,
			dirCount: 0
		};
	}
});
function D(e) {
	let t = (e || "").trim();
	return t = t.replace(/^["']|["']$/g, ""), /^[A-Za-z]:$/.test(t) && (t += "\\"), t;
}
function O(e, t) {
	let n = e?.code, r = s.basename(t);
	return n === "EBUSY" ? `"${r}" is locked or currently open in another program.` : n === "EPERM" || n === "EACCES" ? `Permission denied for "${r}". You may need administrator rights, or the file/folder is write-protected.` : n === "ENOENT" ? `"${r}" could not be found or the destination folder does not exist.` : n === "ENOSPC" ? `Not enough free disk space on the target drive to copy "${r}".` : n === "EINVAL" ? `The file name or path "${r}" contains characters not supported by Windows.` : e?.message?.includes("robocopy failed") ? `Folder copy failed for "${r}" (${e.message}).` : e?.message || `Failed to process "${r}".`;
}
async function k(e, t, n) {
	let r = s.parse(t), i = r.name || t, a = r.ext || "", o = s.join(e, t);
	try {
		await c.access(o);
	} catch {
		return o;
	}
	let l = 1;
	for (; l < 9999;) {
		let t = n && l === 1 ? `${i} - Copy${a}` : `${i} (${l})${a}`, r = s.join(e, t);
		try {
			await c.access(r), l++;
		} catch {
			return r;
		}
	}
	return s.join(e, `${i}_${Date.now()}${a}`);
}
async function A(e, t) {
	let n = s.dirname(t);
	await c.mkdir(n, { recursive: !0 });
	try {
		await c.chmod(t, 438);
	} catch {}
	let r = null;
	for (let n = 0; n < 3; n++) try {
		await c.copyFile(e, t), r = null;
		break;
	} catch (e) {
		if (r = e, e.code === "EPERM" || e.code === "EACCES") try {
			await c.chmod(t, 438);
		} catch {}
		n < 2 && await new Promise((e) => setTimeout(e, 120 * (n + 1)));
	}
	if (r) try {
		await new Promise((n, r) => {
			let i = l.createReadStream(e), a = l.createWriteStream(t, { flags: "w" });
			i.on("error", r), a.on("error", r), a.on("finish", n), i.pipe(a);
		}), r = null;
	} catch (e) {
		throw r || e;
	}
	try {
		let n = await c.stat(e);
		await c.utimes(t, n.atime, n.mtime);
	} catch {}
}
async function j(e, t) {
	let n = e.replace(/[\\/]+$/, ""), r = t.replace(/[\\/]+$/, "");
	if (process.platform === "win32") {
		let e = !1, t = null;
		try {
			await new Promise((e, t) => {
				let i = p("robocopy", [
					n,
					r,
					"/E",
					"/COPY:DAT",
					"/R:1",
					"/W:1",
					"/MT:8",
					"/IS",
					"/NFL",
					"/NDL",
					"/NP"
				]);
				i.stdout?.on("data", (e) => {
					let t = e.toString().trim();
					t && x && x.webContents.send("copy-progress", { line: t.substring(0, 120) });
				}), i.stderr?.on("data", (e) => {
					let t = e.toString().trim();
					t && x && x.webContents.send("copy-progress", { line: "ERR: " + t.substring(0, 110) });
				}), i.on("close", (n) => {
					n >= 8 ? t(/* @__PURE__ */ Error(`robocopy failed with exit code ${n}`)) : e();
				}), i.on("error", (e) => {
					t(e);
				});
			});
		} catch (n) {
			e = !0, t = n;
		}
		if (!e) return;
		console.warn("robocopy failed, falling back to fs.cp:", t?.message);
	}
	await c.cp(e, t, {
		recursive: !0,
		force: !0
	});
}
async function M(e, t) {
	(await c.stat(e)).isDirectory() ? (await j(e, t), x && x.webContents.send("copy-progress", { line: `Copied folder: ${s.basename(t)}` })) : (await A(e, t), x && x.webContents.send("copy-progress", { line: `Copied file: ${s.basename(t)}` }));
}
async function N(e) {
	try {
		await c.rm(e, {
			recursive: !0,
			force: !0
		});
	} catch (t) {
		try {
			await c.chmod(e, 438), await c.rm(e, {
				recursive: !0,
				force: !0
			});
		} catch {
			throw t;
		}
	}
}
async function P(e) {
	let t = "New folder", n = t, r = s.join(e, n), i = 1;
	for (;;) try {
		await c.access(r), n = `${t} (${i})`, r = s.join(e, n), i++;
	} catch {
		break;
	}
	return await c.mkdir(r), r;
}
async function F(e) {
	if (process.platform !== "win32") throw Error("Administrator elevation is only supported on Windows.");
	let t = D(e.target), n = !!e.isMove, r = e.action === "createFolder", i = [];
	if (r) {
		let n = e.newFolderName || "New folder", r = s.join(t, n), a = 1;
		for (;;) try {
			await c.access(r), r = s.join(t, `${n} (${a})`), a++;
		} catch {
			break;
		}
		i.push({
			dest: r,
			action: "createFolder",
			isDirectory: !0
		});
	} else if (e.sources && e.sources.length > 0) for (let r of e.sources) {
		let e = s.basename(r), a = !1;
		try {
			a = (await c.stat(r)).isDirectory();
		} catch {}
		let o = await k(t, e, s.dirname(s.resolve(r)).toLowerCase() === s.resolve(t).toLowerCase() && !n);
		i.push({
			src: r,
			dest: o,
			action: n ? "move" : "copy",
			isDirectory: a
		});
	}
	if (i.length === 0) return {
		success: !0,
		items: []
	};
	let a = `jabro_elevated_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`, o = s.join(d.tmpdir(), `${a}_config.json`), u = s.join(d.tmpdir(), `${a}_worker.ps1`), f = s.join(d.tmpdir(), `${a}_result.json`), m = {
		isMove: n,
		targetDir: t,
		items: i,
		resultFile: f
	};
	await c.writeFile(o, JSON.stringify(m, null, 2), "utf8"), await c.writeFile(u, "\nparam([string]$ConfigPath)\n\n$result = @{\n    success = $false\n    items = @()\n    error = $null\n}\n\ntry {\n    $raw = [System.IO.File]::ReadAllText($ConfigPath, [System.Text.Encoding]::UTF8)\n    $cfg = $raw | ConvertFrom-Json\n    $resPath = [string]$cfg.resultFile\n\n    if (-not (Test-Path -LiteralPath $cfg.targetDir)) {\n        New-Item -ItemType Directory -LiteralPath $cfg.targetDir -Force | Out-Null\n    }\n\n    foreach ($item in $cfg.items) {\n        $src = [string]$item.src\n        $dest = [string]$item.dest\n        $act = [string]$item.action\n        $isDir = [bool]$item.isDirectory\n\n        try {\n            if ($act -eq 'createFolder') {\n                New-Item -ItemType Directory -LiteralPath $dest -Force | Out-Null\n            } elseif ($act -eq 'move') {\n                if (Test-Path -LiteralPath $dest) {\n                    Remove-Item -LiteralPath $dest -Recurse -Force -ErrorAction SilentlyContinue\n                }\n                Move-Item -LiteralPath $src -Destination $dest -Force -ErrorAction Stop\n            } else {\n                if ($isDir) {\n                    if (-not (Test-Path -LiteralPath $dest)) {\n                        New-Item -ItemType Directory -LiteralPath $dest -Force | Out-Null\n                    }\n                    $cleanSrc = $src.TrimEnd('\\', '/')\n                    $cleanDest = $dest.TrimEnd('\\', '/')\n                    $rcArgs = @($cleanSrc, $cleanDest, '/E', '/COPY:DAT', '/R:1', '/W:1', '/IS', '/NFL', '/NDL', '/NP')\n                    $rcProc = Start-Process -FilePath \"robocopy.exe\" -ArgumentList $rcArgs -Wait -NoNewWindow -PassThru\n                    if ($rcProc.ExitCode -ge 8) {\n                        Copy-Item -LiteralPath $src -Destination $dest -Recurse -Force -ErrorAction Stop\n                    }\n                } else {\n                    Copy-Item -LiteralPath $src -Destination $dest -Force -ErrorAction Stop\n                }\n            }\n\n            $result.items += @{\n                src = $src\n                dest = $dest\n                name = [System.IO.Path]::GetFileName($dest)\n                success = $true\n            }\n        } catch {\n            $result.items += @{\n                src = $src\n                dest = $dest\n                name = [System.IO.Path]::GetFileName($src)\n                success = $false\n                error = $_.Exception.Message\n            }\n        }\n    }\n\n    $failed = ($result.items | Where-Object { -not $_.success }).Count\n    if ($failed -eq 0) {\n        $result.success = $true\n    } else {\n        $result.success = $false\n        $result.error = \"Some items failed to copy with administrator rights.\"\n    }\n} catch {\n    $result.success = $false\n    $result.error = $_.Exception.Message\n} finally {\n    if ($resPath) {\n        $out = $result | ConvertTo-Json -Depth 5\n        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)\n        [System.IO.File]::WriteAllText($resPath, $out, $utf8NoBom)\n    }\n}\n", "utf8");
	let h = `
try {
  $p = Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -PassThru -ArgumentList @(
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', '${u.replace(/'/g, "''")}',
      '${o.replace(/'/g, "''")}'
  );
  if ($p.ExitCode -ne 0) {
    exit $p.ExitCode;
  }
} catch {
  [Console]::Error.WriteLine('UAC_CANCELLED');
  exit 1223;
}
`;
	return new Promise((e, t) => {
		let a = p("powershell.exe", [
			"-NoProfile",
			"-Command",
			h
		], { windowsHide: !0 }), d = "";
		a.stderr?.on("data", (e) => {
			d += e.toString();
		}), a.on("close", async (t) => {
			try {
				if (t === 1223 || d.includes("UAC_CANCELLED") || d.includes("canceled by the user")) {
					e({
						success: !1,
						cancelled: !0,
						summary: "Operation cancelled by user."
					});
					return;
				}
				let a = null;
				try {
					if (l.existsSync(f)) {
						let e = await c.readFile(f, "utf8");
						a = JSON.parse(e.replace(/^\uFEFF/, ""));
					}
				} catch (e) {
					console.error("Failed to read elevated result file:", e);
				}
				a && a.success ? e({
					success: !0,
					items: a.items,
					summary: r ? `Created folder "${s.basename(i[0]?.dest)}"` : `Successfully ${n ? "moved" : "copied"} ${a.items?.length || 1} items with administrator privileges.`
				}) : e({
					success: !1,
					error: a?.error || `Elevation process exited with code ${t}`,
					items: a?.items || []
				});
			} finally {
				try {
					await c.unlink(o);
				} catch {}
				try {
					await c.unlink(u);
				} catch {}
				try {
					await c.unlink(f);
				} catch {}
			}
		}), a.on("error", (e) => {
			t(e);
		});
	});
}
r.handle("perform-elevated-op", async (e, t) => F(t)), r.handle("copy-files", async (e, { sources: t, target: n }) => {
	let r = D(n);
	try {
		(await c.stat(r)).isDirectory() || (r = s.dirname(r));
	} catch {}
	try {
		await c.mkdir(r, { recursive: !0 });
	} catch (e) {
		if (e.code === "EPERM" || e.code === "EACCES") return {
			success: !1,
			requiresElevation: !0,
			type: "copy",
			target: r,
			sources: t,
			summary: `Administrator permission is required to copy to "${r}".`,
			errors: [`Permission denied creating or accessing "${r}".`]
		};
	}
	let i = [], a = [];
	for (let e = 0; e < t.length; e++) {
		let n = t[e], o = s.basename(n);
		x && x.webContents.send("copy-progress", {
			line: `Copying ${o} (${e + 1}/${t.length})...`,
			current: e + 1,
			total: t.length,
			fileName: o,
			phase: "copying"
		});
		try {
			try {
				await c.access(n);
			} catch {
				throw Error(`Source "${o}" does not exist or cannot be accessed.`);
			}
			let e = s.dirname(s.resolve(n)).toLowerCase() === s.resolve(r).toLowerCase(), t = await k(r, o, e);
			await M(n, t), i.push({
				src: n,
				dest: t,
				name: s.basename(t),
				success: !0
			});
		} catch (e) {
			let t = O(e, n);
			a.push(t), i.push({
				src: n,
				name: o,
				success: !1,
				error: t
			}), console.error(`Error copying ${n} to ${r}:`, e);
		}
	}
	let o = i.filter((e) => e.success).length, l = i.filter((e) => !e.success).length, u = "";
	if (l === 0) u = o === 1 ? `Successfully copied "${i[0]?.name}"` : `Successfully copied ${o} items`, x && x.webContents.send("copy-progress", {
		line: u,
		phase: "complete",
		success: !0
	});
	else if (o === 0) {
		if (u = `Failed to copy ${t.length === 1 ? `"${s.basename(t[0])}"` : `${t.length} items`}: ${a[0]}`, x && x.webContents.send("copy-progress", {
			line: u,
			phase: "failed",
			success: !1,
			errors: a
		}), a.some((e) => e.includes("Permission denied") || e.includes("administrator"))) return {
			success: !1,
			requiresElevation: !0,
			type: "copy",
			target: r,
			sources: t,
			summary: `Administrator permission is required to copy to "${r}".`,
			errors: a
		};
		throw Error(u);
	} else u = `Copied ${o} of ${t.length} items (${l} failed).`, x && x.webContents.send("copy-progress", {
		line: u,
		phase: "partial",
		success: !1,
		errors: a
	});
	return {
		success: l === 0,
		type: "copy",
		target: r,
		items: i,
		summary: u,
		errors: a
	};
}), r.handle("move-files", async (e, { sources: t, target: n }) => {
	let r = D(n);
	try {
		(await c.stat(r)).isDirectory() || (r = s.dirname(r));
	} catch {}
	try {
		await c.mkdir(r, { recursive: !0 });
	} catch (e) {
		if (e.code === "EPERM" || e.code === "EACCES") return {
			success: !1,
			requiresElevation: !0,
			type: "move",
			target: r,
			sources: t,
			summary: `Administrator permission is required to move to "${r}".`,
			errors: [`Permission denied creating or accessing "${r}".`]
		};
	}
	let i = [], a = [];
	for (let e = 0; e < t.length; e++) {
		let n = t[e], o = s.basename(n);
		x && x.webContents.send("copy-progress", {
			line: `Moving ${o} (${e + 1}/${t.length})...`,
			current: e + 1,
			total: t.length,
			fileName: o,
			phase: "moving"
		});
		try {
			try {
				await c.access(n);
			} catch {
				throw Error(`Source "${o}" does not exist or cannot be accessed.`);
			}
			if (s.dirname(s.resolve(n)).toLowerCase() === s.resolve(r).toLowerCase()) {
				i.push({
					src: n,
					dest: n,
					name: o,
					success: !0
				});
				continue;
			}
			let e = await k(r, o, !1), t = !1;
			try {
				await c.rename(n, e), t = !0;
			} catch (r) {
				if (r.code === "EXDEV" || r.code === "EPERM" || r.code === "EBUSY") await M(n, e), await N(n), t = !0;
				else throw r;
			}
			t && i.push({
				src: n,
				dest: e,
				name: s.basename(e),
				success: !0
			});
		} catch (e) {
			let t = O(e, n);
			a.push(t), i.push({
				src: n,
				name: o,
				success: !1,
				error: t
			}), console.error(`Error moving ${n} to ${r}:`, e);
		}
	}
	let o = i.filter((e) => e.success).length, l = i.filter((e) => !e.success).length, u = "";
	if (l === 0) u = o === 1 ? `Successfully moved "${i[0]?.name}"` : `Successfully moved ${o} items`, x && x.webContents.send("copy-progress", {
		line: u,
		phase: "complete",
		success: !0
	});
	else if (o === 0) {
		if (u = `Failed to move ${t.length === 1 ? `"${s.basename(t[0])}"` : `${t.length} items`}: ${a[0]}`, x && x.webContents.send("copy-progress", {
			line: u,
			phase: "failed",
			success: !1,
			errors: a
		}), a.some((e) => e.includes("Permission denied") || e.includes("administrator"))) return {
			success: !1,
			requiresElevation: !0,
			type: "move",
			target: r,
			sources: t,
			summary: `Administrator permission is required to move to "${r}".`,
			errors: a
		};
		throw Error(u);
	} else u = `Moved ${o} of ${t.length} items (${l} failed).`, x && x.webContents.send("copy-progress", {
		line: u,
		phase: "partial",
		success: !1,
		errors: a
	});
	return {
		success: l === 0,
		type: "move",
		target: r,
		items: i,
		summary: u,
		errors: a
	};
}), r.handle("create-folder", async (e, t) => {
	try {
		return await P(t);
	} catch (e) {
		if (console.error("create-folder failed for", t, e), e.code === "EPERM" || e.code === "EACCES") return {
			success: !1,
			requiresElevation: !0,
			target: t,
			error: "Administrator permission required to create folder here."
		};
		throw e;
	}
}), r.handle("select-folder", async () => {
	if (!x) return null;
	let e = await n.showOpenDialog(x, {
		properties: ["openDirectory", "createDirectory"],
		title: "Open folder"
	});
	return e.canceled || e.filePaths.length === 0 ? null : e.filePaths[0];
}), r.handle("open-path", async (e, t) => {
	await o.openPath(t);
}), r.handle("show-in-explorer", async (e, t) => {
	o.showItemInFolder(t);
}), r.handle("read-text-file", async (e, t) => {
	try {
		return (await c.stat(t)).size > 1024 * 1024 ? "[File too large to preview as text. Use \"Open with default app\".]" : await c.readFile(t, "utf8");
	} catch {
		return "[Unable to read file as text.]";
	}
}), r.handle("open-terminal", async (e, t, n = "cmd") => {
	try {
		let e = t.replace(/"/g, "\\\""), r;
		r = n === "powershell" ? `start powershell -NoExit -Command "Set-Location -LiteralPath '${e}'"` : `start cmd /K "cd /D \\"${e}\\""`, await g(r, { cwd: t });
	} catch (e) {
		console.error("Failed to open terminal", e);
	}
}), r.handle("get-drives", async () => {
	if (process.platform !== "win32") return [{
		name: "/",
		path: "/"
	}];
	try {
		let { stdout: e } = await g("powershell -NoProfile -Command \"[System.IO.DriveInfo]::GetDrives() | Where-Object { $_.IsReady } | Select-Object Name, VolumeLabel, TotalSize, AvailableFreeSpace | ConvertTo-Json -AsArray\""), t = JSON.parse(e || "[]");
		return (Array.isArray(t) ? t : [t]).filter((e) => e.Name).map((e) => ({
			name: e.Name.replace(/\\$/, ""),
			path: e.Name.endsWith("\\") ? e.Name : e.Name + "\\",
			label: e.VolumeLabel || void 0,
			size: e.TotalSize ? Number(e.TotalSize) : void 0,
			freeSpace: e.AvailableFreeSpace ? Number(e.AvailableFreeSpace) : void 0
		}));
	} catch {
		try {
			let { stdout: e } = await g("wmic logicaldisk get name,size,freespace /format:csv"), t = e.trim().split(/\r?\n/).filter(Boolean), n = [];
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
			await c.access(r);
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
