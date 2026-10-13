import { BrowserWindow as e, app as t, dialog as n, ipcMain as r, nativeImage as i, protocol as a, screen as o, session as s, shell as c } from "electron";
import l from "node:path";
import u from "node:fs/promises";
import * as d from "node:fs";
import { Readable as f } from "node:stream";
import p from "node:os";
import m from "node:crypto";
import { exec as h, spawn as g } from "node:child_process";
import { promisify as _ } from "node:util";
import { fileURLToPath as v } from "node:url";
//#region electron/main.ts
var y = _(h), b = v(import.meta.url), x = l.dirname(b);
t.commandLine.appendSwitch("enable-features", "SharedArrayBuffer"), t.commandLine.appendSwitch("allow-file-access-from-files"), t.commandLine.appendSwitch("disable-geolocation"), t.commandLine.appendSwitch("disable-background-networking"), t.commandLine.appendSwitch("disable-features", "Geolocation,WebBluetooth,WebUSB,MediaRouter"), a.registerSchemesAsPrivileged([{
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
function S() {
	return t.isPackaged ? l.join(process.resourcesPath, "app.asar", "dist-electron", "preload.js") : l.join(x, "preload.js");
}
function C() {
	return t.isPackaged ? l.join(process.resourcesPath, "app.asar", "dist", "index.html") : l.join(x, "../dist/index.html");
}
var w = null, T = () => l.join(t.getPath("userData"), "window-bounds.json");
function E() {
	try {
		if (d.existsSync(T())) {
			let e = d.readFileSync(T(), "utf8"), t = JSON.parse(e);
			if (t && typeof t.width == "number" && typeof t.height == "number") {
				if (t.width < 400 || t.height < 300 || t.x !== void 0 && (t.x < -1e4 || t.y < -1e4)) return null;
				try {
					if (!o.getAllDisplays().some((e) => {
						let n = e.bounds;
						return t.x >= n.x - 200 && t.x < n.x + n.width && t.y >= n.y - 100 && t.y < n.y + n.height;
					})) return null;
				} catch {}
				return t;
			}
		}
	} catch {}
	return null;
}
function D(e) {
	try {
		if (!e || e.isDestroyed() || e.isMinimized()) return;
		let t = {
			...e.isMaximized() && e.getNormalBounds ? e.getNormalBounds() : e.getBounds(),
			isMaximized: e.isMaximized()
		};
		d.writeFileSync(T(), JSON.stringify(t));
	} catch {}
}
function O() {
	let t = E(), n = {
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
			preload: S(),
			contextIsolation: !0,
			nodeIntegration: !1,
			webSecurity: !1
		}
	};
	t && (n.x = t.x, n.y = t.y, n.width = t.width, n.height = t.height), w = new e(n), t && t.isMaximized && w.maximize();
	let r = process.env.VITE_DEV_SERVER_URL;
	if (r) {
		let e = () => {
			w?.loadURL(r).catch((t) => {
				console.warn("[Main] Dev server connect failed, retrying in 350ms...", t), setTimeout(() => {
					w && !w.isDestroyed() && e();
				}, 350);
			});
		};
		e();
	} else w.loadFile(C()).catch((e) => {
		console.error("[Main] Failed to load index.html:", e);
	});
	w.webContents.on("did-fail-load", (e, t, n, i) => {
		console.warn(`[Main] did-fail-load: ${n} (${t}) for ${i}`), r && i && i.includes("localhost") && setTimeout(() => {
			w && !w.isDestroyed() && (console.log("[Main] Dev server retry on did-fail-load..."), w.loadURL(r).catch(() => {}));
		}, 500);
	}), w.webContents.on("render-process-gone", (e, t) => {
		console.error("[Main] Render process gone:", t), t.reason !== "clean-exit" && w && !w.isDestroyed() && w.reload();
	}), w.webContents.on("console-message", (e, t, n, r, i) => {
		console.log(`[Renderer LOG ${t}] ${n} (${i}:${r})`);
	}), w.on("moved", () => D(w)), w.on("resized", () => D(w)), w.on("close", () => D(w)), w.on("closed", () => {
		w = null;
	});
}
t.whenReady().then(() => {
	s.defaultSession.webRequest.onHeadersReceived((e, t) => {
		let n = { ...e.responseHeaders };
		e.resourceType === "mainFrame" && !e.url.startsWith("chrome-extension:") && (n["Cross-Origin-Opener-Policy"] = ["same-origin"], n["Cross-Origin-Embedder-Policy"] = ["credentialless"]), t({ responseHeaders: n });
	}), s.defaultSession.setPermissionRequestHandler((e, t, n) => {
		let r = t;
		if ([
			"geolocation",
			"geolocation-approximate",
			"sensors",
			"notifications",
			"media"
		].includes(r)) return n(!1);
		n(!0);
	}), s.defaultSession.setPermissionCheckHandler((e, t) => {
		let n = t;
		return ![
			"geolocation",
			"geolocation-approximate",
			"sensors",
			"notifications",
			"media"
		].includes(n);
	}), a.handle("jabro-media", async (e) => {
		let t = "";
		try {
			let n = new URL(e.url);
			if (t = n.searchParams.get("path") || "", !t) {
				let e = decodeURIComponent(n.pathname);
				process.platform === "win32" && e.startsWith("/") && /^[a-zA-Z]:/.test(e.slice(1)) && (e = e.slice(1)), t = e;
			}
			t &&= ((t.startsWith("\\\\?\\") || t.startsWith("//?/")) && (t = t.slice(4)), l.normalize(t));
			let r = await u.stat(t), i = l.extname(t).toLowerCase(), a = new Headers(), o = "";
			i === ".pdf" ? o = "application/pdf" : i === ".jpg" || i === ".jpeg" ? o = "image/jpeg" : i === ".png" ? o = "image/png" : i === ".webp" ? o = "image/webp" : i === ".gif" ? o = "image/gif" : i === ".svg" ? o = "image/svg+xml" : i === ".bmp" ? o = "image/bmp" : i === ".ico" ? o = "image/x-icon" : i === ".tga" ? o = "image/x-tga" : i === ".dds" ? o = "image/vnd-ms.dds" : i === ".glb" ? o = "model/gltf-binary" : i === ".gltf" ? o = "model/gltf+json" : i === ".wasm" ? o = "application/wasm" : i === ".js" ? o = "application/javascript" : i === ".obj" ? o = "text/plain" : (i === ".stl" || i === ".ply" || i === ".splat" || i === ".ksplat" || i === ".spz" || i === ".fbx") && (o = "application/octet-stream"), o && a.set("content-type", o), a.set("access-control-allow-origin", "*"), a.set("access-control-expose-headers", "Content-Length, Content-Range, Accept-Ranges"), a.set("accept-ranges", "bytes"), a.set("Cross-Origin-Resource-Policy", "cross-origin");
			let s = e.headers.get("range"), c = 200, p;
			if (s) {
				let e = /bytes=(\d*)-(\d*)/.exec(s);
				if (e) {
					let n, i;
					if (e[1] === "") {
						let t = parseInt(e[2], 10);
						n = Math.max(0, r.size - t), i = r.size - 1;
					} else n = parseInt(e[1], 10), i = e[2] ? parseInt(e[2], 10) : r.size - 1;
					if (!isNaN(n) && n < r.size) {
						let e = Math.min(isNaN(i) ? r.size - 1 : i, r.size - 1), o = e - n + 1;
						a.set("content-length", o.toString()), a.set("content-range", `bytes ${n}-${e}/${r.size}`), c = 206, p = d.createReadStream(t, {
							start: n,
							end: e
						});
					} else a.set("content-length", r.size.toString()), p = d.createReadStream(t);
				} else a.set("content-length", r.size.toString()), p = d.createReadStream(t);
			} else a.set("content-length", r.size.toString()), p = d.createReadStream(t);
			let m = f.toWeb(p);
			return new Response(m, {
				status: c,
				headers: a
			});
		} catch (e) {
			return console.error("jabro-media protocol error for path:", t, e), new Response("File not found: " + (e?.message || "Not found"), { status: 404 });
		}
	}), r.handle("detect-ply-type", async (e, t) => {
		try {
			let e = await u.open(t, "r"), n = Buffer.alloc(4096), { bytesRead: r } = await e.read(n, 0, 4096, 0);
			await e.close();
			let i = n.toString("utf8", 0, r);
			return i.includes("f_dc_") || i.includes("opacity") || i.includes("scale_0") || i.includes("rot_0") || i.includes("packed_position") ? "gaussian-splat" : "3d";
		} catch (e) {
			return console.error("detect-ply-type error:", e), "3d";
		}
	}), O(), t.on("activate", () => {
		e.getAllWindows().length === 0 && O();
	});
}), t.on("window-all-closed", () => {
	process.platform !== "darwin" && t.quit();
}), r.handle("list-directory", async (e, t) => {
	try {
		let e = await u.readdir(t, { withFileTypes: !0 }), n = [];
		for (let r of e) {
			if (r.name.startsWith("._")) continue;
			let e = l.join(t, r.name), i = r.isDirectory(), a = i ? void 0 : l.extname(r.name).toLowerCase() || void 0, o = (/* @__PURE__ */ new Date()).toISOString(), s;
			try {
				let t = await u.stat(e);
				o = t.mtime.toISOString(), i || (s = t.size);
			} catch {
				i || (s = 0);
			}
			n.push({
				name: r.name,
				path: e,
				isDirectory: i,
				mtime: o,
				ext: a,
				size: i ? void 0 : s
			});
		}
		return n.sort((e, t) => e.isDirectory === t.isDirectory ? e.name.localeCompare(t.name, void 0, { sensitivity: "base" }) : e.isDirectory ? -1 : 1), n;
	} catch (e) {
		return console.error("list-directory error", t, e), [];
	}
});
async function k(e, t = 12) {
	let n = 0, r = 0, i = 0, a = [e], o = [], s = async () => {
		for (; a.length > 0;) {
			let t = a.shift();
			if (!t) break;
			let o;
			try {
				o = await u.readdir(t, { withFileTypes: !0 });
			} catch {
				continue;
			}
			t !== e && i++;
			for (let e of o) {
				if (e.name.startsWith("._")) continue;
				let i = l.join(t, e.name);
				if (e.isDirectory()) a.push(i);
				else if (e.isFile()) try {
					let e = await u.stat(i);
					n += e.size, r++;
				} catch {}
			}
		}
	};
	for (let e = 0; e < t; e++) o.push(s());
	return await Promise.all(o), {
		size: n,
		fileCount: r,
		dirCount: i
	};
}
r.handle("get-folder-size", async (e, t) => {
	try {
		return await k(t);
	} catch (e) {
		return console.error("get-folder-size failed", t, e), {
			size: 0,
			fileCount: 0,
			dirCount: 0
		};
	}
});
async function A(e, t = 50, n = 5e4) {
	let r = [], i = [e], a = 0;
	for (; i.length > 0 && a < n;) {
		let e = i.shift();
		if (!e) break;
		let n;
		try {
			n = await u.readdir(e, { withFileTypes: !0 });
		} catch {
			continue;
		}
		for (let o of n) {
			if (o.name.startsWith("._") || o.name === "$RECYCLE.BIN" || o.name === "System Volume Information") continue;
			let n = l.join(e, o.name);
			if (o.isDirectory()) i.push(n);
			else if (o.isFile()) {
				a++;
				try {
					let e = await u.stat(n), i = l.extname(o.name), a = {
						name: o.name,
						path: n,
						size: e.size,
						mtime: e.mtime.toISOString(),
						ext: i
					};
					r.length < t ? (r.push(a), r.sort((e, t) => t.size - e.size)) : e.size > r[r.length - 1].size && (r.pop(), r.push(a), r.sort((e, t) => t.size - e.size));
				} catch {}
			}
		}
	}
	return r;
}
r.handle("find-largest-files", async (e, { dirPath: t, limit: n }) => {
	try {
		return await A(t, n || 50);
	} catch (e) {
		return console.error("find-largest-files failed", t, e), [];
	}
});
function j(e) {
	let t = (e || "").trim();
	return t = t.replace(/^["']|["']$/g, ""), /^[A-Za-z]:$/.test(t) && (t += "\\"), t;
}
function M(e, t) {
	let n = e?.code, r = l.basename(t);
	return n === "EBUSY" ? `"${r}" is locked or currently open in another program.` : n === "EPERM" || n === "EACCES" ? `Permission denied for "${r}". You may need administrator rights, or the file/folder is write-protected.` : n === "ENOENT" ? `"${r}" could not be found or the destination folder does not exist.` : n === "ENOSPC" ? `Not enough free disk space on the target drive to copy "${r}".` : n === "EINVAL" ? `The file name or path "${r}" contains characters not supported by Windows.` : e?.message?.includes("robocopy failed") ? `Folder copy failed for "${r}" (${e.message}).` : e?.message || `Failed to process "${r}".`;
}
async function N(e, t, n) {
	let r = l.parse(t), i = r.name || t, a = r.ext || "", o = l.join(e, t);
	try {
		await u.access(o);
	} catch {
		return o;
	}
	let s = 1;
	for (; s < 9999;) {
		let t = n && s === 1 ? `${i} - Copy${a}` : `${i} (${s})${a}`, r = l.join(e, t);
		try {
			await u.access(r), s++;
		} catch {
			return r;
		}
	}
	return l.join(e, `${i}_${Date.now()}${a}`);
}
async function P(e, t) {
	let n = l.dirname(t);
	await u.mkdir(n, { recursive: !0 });
	try {
		await u.chmod(t, 438);
	} catch {}
	let r = null;
	for (let n = 0; n < 3; n++) try {
		await u.copyFile(e, t), r = null;
		break;
	} catch (e) {
		if (r = e, e.code === "EPERM" || e.code === "EACCES") try {
			await u.chmod(t, 438);
		} catch {}
		n < 2 && await new Promise((e) => setTimeout(e, 120 * (n + 1)));
	}
	if (r) try {
		await new Promise((n, r) => {
			let i = d.createReadStream(e), a = d.createWriteStream(t, { flags: "w" });
			i.on("error", r), a.on("error", r), a.on("finish", n), i.pipe(a);
		}), r = null;
	} catch (e) {
		throw r || e;
	}
	try {
		let n = await u.stat(e);
		await u.utimes(t, n.atime, n.mtime);
	} catch {}
}
async function F(e, t) {
	let n = e.replace(/[\\/]+$/, ""), r = t.replace(/[\\/]+$/, "");
	if (process.platform === "win32") {
		let e = !1, t = null;
		try {
			await new Promise((e, t) => {
				let i = g("robocopy", [
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
					t && w && w.webContents.send("copy-progress", { line: t.substring(0, 120) });
				}), i.stderr?.on("data", (e) => {
					let t = e.toString().trim();
					t && w && w.webContents.send("copy-progress", { line: "ERR: " + t.substring(0, 110) });
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
	await u.cp(e, t, {
		recursive: !0,
		force: !0
	});
}
async function I(e, t) {
	(await u.stat(e)).isDirectory() ? (await F(e, t), w && w.webContents.send("copy-progress", { line: `Copied folder: ${l.basename(t)}` })) : (await P(e, t), w && w.webContents.send("copy-progress", { line: `Copied file: ${l.basename(t)}` }));
}
async function L(e) {
	try {
		await u.rm(e, {
			recursive: !0,
			force: !0
		});
	} catch (t) {
		try {
			await u.chmod(e, 438), await u.rm(e, {
				recursive: !0,
				force: !0
			});
		} catch {
			throw t;
		}
	}
}
async function R(e) {
	let t = "New folder", n = t, r = l.join(e, n), i = 1;
	for (;;) try {
		await u.access(r), n = `${t} (${i})`, r = l.join(e, n), i++;
	} catch {
		break;
	}
	return await u.mkdir(r), r;
}
async function z(e) {
	if (process.platform !== "win32") throw Error("Administrator elevation is only supported on Windows.");
	let t = j(e.target), n = !!e.isMove, r = e.action === "createFolder", i = [];
	if (r) {
		let n = e.newFolderName || "New folder", r = l.join(t, n), a = 1;
		for (;;) try {
			await u.access(r), r = l.join(t, `${n} (${a})`), a++;
		} catch {
			break;
		}
		i.push({
			dest: r,
			action: "createFolder",
			isDirectory: !0
		});
	} else if (e.sources && e.sources.length > 0) for (let r of e.sources) {
		let a = e.customDestFileName && e.sources.length === 1 ? e.customDestFileName : l.basename(r), o = !1;
		try {
			o = (await u.stat(r)).isDirectory();
		} catch {}
		let s = l.dirname(l.resolve(r)).toLowerCase() === l.resolve(t).toLowerCase(), c = e.customDestFileName && e.sources.length === 1 ? l.join(t, e.customDestFileName) : await N(t, a, s && !n);
		i.push({
			src: r,
			dest: c,
			action: n ? "move" : "copy",
			isDirectory: o
		});
	}
	if (i.length === 0) return {
		success: !0,
		items: []
	};
	let a = `jabro_elevated_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`, o = l.join(p.tmpdir(), `${a}_config.json`), s = l.join(p.tmpdir(), `${a}_worker.ps1`), c = l.join(p.tmpdir(), `${a}_result.json`), f = {
		isMove: n,
		targetDir: t,
		items: i,
		resultFile: c
	};
	await u.writeFile(o, JSON.stringify(f, null, 2), "utf8"), await u.writeFile(s, "\nparam([string]$ConfigPath)\n\n$result = @{\n    success = $false\n    items = @()\n    error = $null\n}\n\ntry {\n    $raw = [System.IO.File]::ReadAllText($ConfigPath, [System.Text.Encoding]::UTF8)\n    $cfg = $raw | ConvertFrom-Json\n    $resPath = [string]$cfg.resultFile\n\n    if (-not (Test-Path -LiteralPath $cfg.targetDir)) {\n        New-Item -ItemType Directory -LiteralPath $cfg.targetDir -Force | Out-Null\n    }\n\n    foreach ($item in $cfg.items) {\n        $src = [string]$item.src\n        $dest = [string]$item.dest\n        $act = [string]$item.action\n        $isDir = [bool]$item.isDirectory\n\n        try {\n            if ($act -eq 'createFolder') {\n                New-Item -ItemType Directory -LiteralPath $dest -Force | Out-Null\n            } elseif ($act -eq 'move') {\n                if (Test-Path -LiteralPath $dest) {\n                    Remove-Item -LiteralPath $dest -Recurse -Force -ErrorAction SilentlyContinue\n                }\n                Move-Item -LiteralPath $src -Destination $dest -Force -ErrorAction Stop\n            } else {\n                if ($isDir) {\n                    if (-not (Test-Path -LiteralPath $dest)) {\n                        New-Item -ItemType Directory -LiteralPath $dest -Force | Out-Null\n                    }\n                    $cleanSrc = $src.TrimEnd('\\', '/')\n                    $cleanDest = $dest.TrimEnd('\\', '/')\n                    $rcArgs = @($cleanSrc, $cleanDest, '/E', '/COPY:DAT', '/R:1', '/W:1', '/IS', '/NFL', '/NDL', '/NP')\n                    $rcProc = Start-Process -FilePath \"robocopy.exe\" -ArgumentList $rcArgs -Wait -NoNewWindow -PassThru\n                    if ($rcProc.ExitCode -ge 8) {\n                        Copy-Item -LiteralPath $src -Destination $dest -Recurse -Force -ErrorAction Stop\n                    }\n                } else {\n                    Copy-Item -LiteralPath $src -Destination $dest -Force -ErrorAction Stop\n                }\n            }\n\n            $result.items += @{\n                src = $src\n                dest = $dest\n                name = [System.IO.Path]::GetFileName($dest)\n                success = $true\n            }\n        } catch {\n            $result.items += @{\n                src = $src\n                dest = $dest\n                name = [System.IO.Path]::GetFileName($src)\n                success = $false\n                error = $_.Exception.Message\n            }\n        }\n    }\n\n    $failed = ($result.items | Where-Object { -not $_.success }).Count\n    if ($failed -eq 0) {\n        $result.success = $true\n    } else {\n        $result.success = $false\n        $result.error = \"Some items failed to copy with administrator rights.\"\n    }\n} catch {\n    $result.success = $false\n    $result.error = $_.Exception.Message\n} finally {\n    if ($resPath) {\n        $out = $result | ConvertTo-Json -Depth 5\n        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)\n        [System.IO.File]::WriteAllText($resPath, $out, $utf8NoBom)\n    }\n}\n", "utf8");
	let m = `
try {
  $p = Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -PassThru -ArgumentList @(
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', '${s.replace(/'/g, "''")}',
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
		let a = g("powershell.exe", [
			"-NoProfile",
			"-Command",
			m
		], { windowsHide: !0 }), f = "";
		a.stderr?.on("data", (e) => {
			f += e.toString();
		}), a.on("close", async (t) => {
			try {
				if (t === 1223 || f.includes("UAC_CANCELLED") || f.includes("canceled by the user")) {
					e({
						success: !1,
						cancelled: !0,
						summary: "Operation cancelled by user."
					});
					return;
				}
				let a = null;
				try {
					if (d.existsSync(c)) {
						let e = await u.readFile(c, "utf8");
						a = JSON.parse(e.replace(/^\uFEFF/, ""));
					}
				} catch (e) {
					console.error("Failed to read elevated result file:", e);
				}
				a && a.success ? e({
					success: !0,
					items: a.items,
					summary: r ? `Created folder "${l.basename(i[0]?.dest)}"` : `Successfully ${n ? "moved" : "copied"} ${a.items?.length || 1} items with administrator privileges.`
				}) : e({
					success: !1,
					error: a?.error || `Elevation process exited with code ${t}`,
					items: a?.items || []
				});
			} finally {
				try {
					await u.unlink(o);
				} catch {}
				try {
					await u.unlink(s);
				} catch {}
				try {
					await u.unlink(c);
				} catch {}
			}
		}), a.on("error", (e) => {
			t(e);
		});
	});
}
r.handle("perform-elevated-op", async (e, t) => z(t)), r.handle("copy-files", async (e, { sources: t, target: n }) => {
	let r = j(n);
	try {
		(await u.stat(r)).isDirectory() || (r = l.dirname(r));
	} catch {}
	try {
		await u.mkdir(r, { recursive: !0 });
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
		let n = t[e], o = l.basename(n);
		w && w.webContents.send("copy-progress", {
			line: `Copying ${o} (${e + 1}/${t.length})...`,
			current: e + 1,
			total: t.length,
			fileName: o,
			phase: "copying"
		});
		try {
			try {
				await u.access(n);
			} catch {
				throw Error(`Source "${o}" does not exist or cannot be accessed.`);
			}
			let e = l.dirname(l.resolve(n)).toLowerCase() === l.resolve(r).toLowerCase(), t = await N(r, o, e);
			await I(n, t), i.push({
				src: n,
				dest: t,
				name: l.basename(t),
				success: !0
			});
		} catch (e) {
			let t = M(e, n);
			a.push(t), i.push({
				src: n,
				name: o,
				success: !1,
				error: t
			}), console.error(`Error copying ${n} to ${r}:`, e);
		}
	}
	let o = i.filter((e) => e.success).length, s = i.filter((e) => !e.success).length, c = "";
	if (s === 0) c = o === 1 ? `Successfully copied "${i[0]?.name}"` : `Successfully copied ${o} items`, w && w.webContents.send("copy-progress", {
		line: c,
		phase: "complete",
		success: !0
	});
	else if (o === 0) {
		if (c = `Failed to copy ${t.length === 1 ? `"${l.basename(t[0])}"` : `${t.length} items`}: ${a[0]}`, w && w.webContents.send("copy-progress", {
			line: c,
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
		throw Error(c);
	} else c = `Copied ${o} of ${t.length} items (${s} failed).`, w && w.webContents.send("copy-progress", {
		line: c,
		phase: "partial",
		success: !1,
		errors: a
	});
	return {
		success: s === 0,
		type: "copy",
		target: r,
		items: i,
		summary: c,
		errors: a
	};
}), r.handle("move-files", async (e, { sources: t, target: n }) => {
	let r = j(n);
	try {
		(await u.stat(r)).isDirectory() || (r = l.dirname(r));
	} catch {}
	try {
		await u.mkdir(r, { recursive: !0 });
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
		let n = t[e], o = l.basename(n);
		w && w.webContents.send("copy-progress", {
			line: `Moving ${o} (${e + 1}/${t.length})...`,
			current: e + 1,
			total: t.length,
			fileName: o,
			phase: "moving"
		});
		try {
			try {
				await u.access(n);
			} catch {
				throw Error(`Source "${o}" does not exist or cannot be accessed.`);
			}
			if (l.dirname(l.resolve(n)).toLowerCase() === l.resolve(r).toLowerCase()) {
				i.push({
					src: n,
					dest: n,
					name: o,
					success: !0
				});
				continue;
			}
			let e = await N(r, o, !1), t = !1;
			try {
				await u.rename(n, e), t = !0;
			} catch (r) {
				if (r.code === "EXDEV" || r.code === "EPERM" || r.code === "EBUSY") await I(n, e), await L(n), t = !0;
				else throw r;
			}
			t && i.push({
				src: n,
				dest: e,
				name: l.basename(e),
				success: !0
			});
		} catch (e) {
			let t = M(e, n);
			a.push(t), i.push({
				src: n,
				name: o,
				success: !1,
				error: t
			}), console.error(`Error moving ${n} to ${r}:`, e);
		}
	}
	let o = i.filter((e) => e.success).length, s = i.filter((e) => !e.success).length, c = "";
	if (s === 0) c = o === 1 ? `Successfully moved "${i[0]?.name}"` : `Successfully moved ${o} items`, w && w.webContents.send("copy-progress", {
		line: c,
		phase: "complete",
		success: !0
	});
	else if (o === 0) {
		if (c = `Failed to move ${t.length === 1 ? `"${l.basename(t[0])}"` : `${t.length} items`}: ${a[0]}`, w && w.webContents.send("copy-progress", {
			line: c,
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
		throw Error(c);
	} else c = `Moved ${o} of ${t.length} items (${s} failed).`, w && w.webContents.send("copy-progress", {
		line: c,
		phase: "partial",
		success: !1,
		errors: a
	});
	return {
		success: s === 0,
		type: "move",
		target: r,
		items: i,
		summary: c,
		errors: a
	};
}), r.handle("create-folder", async (e, t) => {
	try {
		return await R(t);
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
	if (!w) return null;
	let e = await n.showOpenDialog(w, {
		properties: ["openDirectory", "createDirectory"],
		title: "Open folder"
	});
	return e.canceled || e.filePaths.length === 0 ? null : e.filePaths[0];
}), r.handle("save-file-as", async (e, t) => {
	if (!w) return { canceled: !0 };
	try {
		if ((await u.stat(t)).isDirectory()) return {
			success: !1,
			error: "Cannot \"Save as\" a directory. Please select a file."
		};
	} catch (e) {
		return {
			success: !1,
			error: `Source file does not exist or cannot be accessed: ${e?.message || e}`
		};
	}
	let r = l.extname(t).replace(/^\./, ""), i = [];
	r && i.push({
		name: `${r.toUpperCase()} File (*.${r})`,
		extensions: [r]
	}), i.push({
		name: "All Files (*.*)",
		extensions: ["*"]
	});
	let a = await n.showSaveDialog(w, {
		title: "Save As",
		defaultPath: t,
		filters: i,
		properties: ["showOverwriteConfirmation", "createDirectory"]
	});
	if (a.canceled || !a.filePath) return { canceled: !0 };
	let o = a.filePath;
	if (l.resolve(t).toLowerCase() === l.resolve(o).toLowerCase()) return {
		success: !1,
		error: "Destination is identical to the source file."
	};
	try {
		return await u.mkdir(l.dirname(o), { recursive: !0 }), await P(t, o), {
			success: !0,
			sourcePath: t,
			destPath: o,
			destDir: l.dirname(o),
			destFileName: l.basename(o)
		};
	} catch (e) {
		let n = e?.message || String(e);
		return n.includes("EPERM") || n.includes("EACCES") || n.includes("Permission denied") ? {
			success: !1,
			requiresElevation: !0,
			sourcePath: t,
			destPath: o,
			destDir: l.dirname(o),
			destFileName: l.basename(o),
			error: n
		} : {
			success: !1,
			error: n
		};
	}
}), r.handle("open-path", async (e, t) => {
	await c.openPath(t);
}), r.handle("show-in-explorer", async (e, t) => {
	c.showItemInFolder(t);
}), r.handle("read-text-file", async (e, t) => {
	try {
		return (await u.stat(t)).size > 1024 * 1024 ? "[File too large to preview as text. Use \"Open with default app\".]" : await u.readFile(t, "utf8");
	} catch {
		return "[Unable to read file as text.]";
	}
}), r.handle("read-binary-file", async (e, t) => {
	try {
		return await u.readFile(t);
	} catch (e) {
		return console.error("read-binary-file failed:", e), null;
	}
}), r.handle("open-terminal", async (e, t, n = "cmd") => {
	try {
		let e = t.replace(/"/g, "\\\""), r;
		r = n === "powershell" ? `start powershell -NoExit -Command "Set-Location -LiteralPath '${e}'"` : `start cmd /K "cd /D \\"${e}\\""`, await y(r, { cwd: t });
	} catch (e) {
		console.error("Failed to open terminal", e);
	}
}), r.handle("get-drives", async () => {
	if (process.platform !== "win32") return [{
		name: "/",
		path: "/"
	}];
	try {
		let { stdout: e } = await y("powershell -NoProfile -Command \"@(Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID, VolumeName, Description, Size, FreeSpace) | ConvertTo-Json\""), t = JSON.parse(e || "[]"), n = (Array.isArray(t) ? t : [t]).filter((e) => e?.DeviceID && /^[A-Za-z]:/i.test(e.DeviceID)).map((e) => {
			let t = e.VolumeName && typeof e.VolumeName == "string" && e.VolumeName.trim() ? e.VolumeName.trim() : void 0;
			return t || (e.Description === "Removable Disk" ? t = "Removable Disk" : e.Description === "Local Fixed Disk" ? t = "Local Disk" : e.Description && typeof e.Description == "string" && e.Description.trim() && (t = e.Description.trim())), {
				name: e.DeviceID.replace(/\\$/, ""),
				path: e.DeviceID.endsWith("\\") ? e.DeviceID : e.DeviceID + "\\",
				label: t,
				size: e.Size != null && e.Size > 0 ? Number(e.Size) : void 0,
				freeSpace: e.FreeSpace == null ? void 0 : Number(e.FreeSpace)
			};
		});
		if (n.length > 0) return n;
	} catch (e) {
		console.error("get-drives CIM query failed, trying fallback", e);
	}
	let e = [
		"C:\\",
		"D:\\",
		"E:\\",
		"F:\\",
		"G:\\",
		"H:\\"
	], t = [];
	for (let n of e) try {
		await u.access(n);
		let e = n[0];
		t.push({
			name: e + ":",
			path: n
		});
	} catch {}
	return t.length ? t : [{
		name: "C:",
		path: "C:\\"
	}];
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
var B = l.join(t.getPath("userData"), "thumbnails_cache");
try {
	d.mkdirSync(B, { recursive: !0 });
} catch (e) {
	console.error("Failed to initialize thumbnail cache dir:", e);
}
var V = new Set(/* @__PURE__ */ ".png,.jpg,.jpeg,.webp,.bmp,.gif,.ico,.svg,.tif,.tiff,.jfif,.avif,.mp4,.mov,.mkv,.avi,.wmv,.webm,.m4v,.flv,.pdf,.glb,.gltf,.obj,.stl,.ply,.fbx,.splat,.ksplat,.spz".split(","));
function H(e, t, n) {
	return m.createHash("sha256").update(`${e}:${t}:${n || 0}:256`).digest("hex");
}
function U(e) {
	return `jabro-media://localhost?path=${encodeURIComponent(e)}`;
}
var W = new class {
	queue = [];
	activeCount = 0;
	maxConcurrency = 6;
	inFlight = /* @__PURE__ */ new Map();
	enqueue(e, t) {
		if (this.inFlight.has(e)) return this.inFlight.get(e);
		let n = new Promise((n) => {
			this.queue.push(async () => {
				try {
					n(await t());
				} catch (t) {
					console.error("[ThumbnailQueue] task failed for key", e, t), n({ hasPreview: !1 });
				} finally {
					this.activeCount--, this.inFlight.delete(e), this.dispatch();
				}
			}), this.dispatch();
		});
		return this.inFlight.set(e, n), n;
	}
	dispatch() {
		for (; this.activeCount < this.maxConcurrency && this.queue.length > 0;) {
			let e = this.queue.shift();
			e && (this.activeCount++, e());
		}
	}
}();
async function G(e, t, n) {
	let r = [
		".png",
		".jpg",
		".jpeg",
		".webp",
		".bmp",
		".gif",
		".ico",
		".jfif"
	].includes(n);
	try {
		await u.mkdir(l.dirname(t), { recursive: !0 });
	} catch {}
	if (r) try {
		let n = i.createFromPath(e);
		if (!n.isEmpty()) {
			let e = n.getSize();
			if (e.width > 0 && e.height > 0) {
				let r = e.width, i = e.height;
				(r > 256 || i > 256) && (r >= i ? (i = Math.round(i * 256 / r), r = 256) : (r = Math.round(r * 256 / i), i = 256));
				let a = n.resize({
					width: Math.max(1, r),
					height: Math.max(1, i),
					quality: "good"
				}).toJPEG(82);
				return await u.writeFile(t, a), !0;
			}
		}
	} catch {}
	try {
		if (typeof i.createThumbnailFromPath == "function") {
			let n = await i.createThumbnailFromPath(e, {
				width: 256,
				height: 256
			});
			if (!n.isEmpty()) {
				let e = n.getSize(), r = n;
				if (e.width > 0 && e.height > 0 && e.width !== e.height) {
					let t = Math.min(e.width, e.height), i = Math.round((e.width - t) / 2), a = Math.round((e.height - t) / 2);
					r = n.crop({
						x: i,
						y: a,
						width: t,
						height: t
					});
				}
				let i = r.toJPEG(82);
				return await u.writeFile(t, i), !0;
			}
		}
	} catch {}
	return !1;
}
r.handle("get-thumbnail", async (e, { filePath: t, mtime: n, size: r }) => {
	if (!t) return { hasPreview: !1 };
	let i = l.extname(t).toLowerCase();
	if (!V.has(i)) return { hasPreview: !1 };
	let a = n, o = r;
	if (!a || o === void 0 || o === 0) try {
		let e = await u.stat(t);
		a = e.mtime.toISOString(), o = e.size;
	} catch {}
	let s = H(t, a, o), c = l.join(B, `${s}.jpg`);
	return d.existsSync(c) ? {
		url: U(c),
		hasPreview: !0
	} : W.enqueue(s, async () => d.existsSync(c) || await G(t, c, i) ? {
		url: U(c),
		hasPreview: !0
	} : { hasPreview: !1 });
}), r.handle("get-thumbnails-batch", async (e, t) => {
	let n = {};
	if (!Array.isArray(t)) return n;
	for (let e of t) {
		if (!e?.filePath) continue;
		let t = l.extname(e.filePath).toLowerCase();
		if (!V.has(t)) continue;
		let r = H(e.filePath, e.mtime, e.size), i = l.join(B, `${r}.jpg`);
		d.existsSync(i) && (n[e.filePath] = U(i));
	}
	return n;
}), r.handle("read-file-snippet", async (e, t, n = 240) => {
	try {
		let e = await u.open(t, "r"), r = Buffer.alloc(1024), { bytesRead: i } = await e.read(r, 0, 1024, 0);
		return await e.close(), r.toString("utf8", 0, i).slice(0, n);
	} catch {
		return "";
	}
}), r.handle("get-thumbnail-cache-stats", async () => {
	try {
		let e = await u.readdir(B), t = 0, n = 0;
		for (let r of e) if (r.endsWith(".jpg") || r.endsWith(".webp")) {
			n++;
			try {
				let e = await u.stat(l.join(B, r));
				t += e.size;
			} catch {}
		}
		return {
			count: n,
			sizeBytes: t,
			cachePath: B
		};
	} catch {
		return {
			count: 0,
			sizeBytes: 0,
			cachePath: B
		};
	}
}), r.handle("clear-thumbnail-cache", async () => {
	try {
		let e = await u.readdir(B), t = 0, n = 0;
		for (let r of e) if (r.endsWith(".jpg") || r.endsWith(".webp")) {
			let e = l.join(B, r);
			try {
				let r = await u.stat(e);
				t += r.size, await u.unlink(e), n++;
			} catch {}
		}
		return {
			success: !0,
			count: n,
			clearedBytes: t
		};
	} catch (e) {
		return console.error("Failed to clear thumbnail cache:", e), {
			success: !1,
			count: 0,
			clearedBytes: 0
		};
	}
}), r.handle("open-thumbnail-cache-folder", async () => {
	try {
		await c.openPath(B);
	} catch (e) {
		console.error("Failed to open thumbnail cache folder:", e);
	}
}), r.handle("save-thumbnail-cache", async (e, { filePath: t, dataUrl: n, mtime: r, size: a }) => {
	try {
		if (!t || !n) return !1;
		let e = n.replace(/^data:image\/\w+;base64,/, ""), o = Buffer.from(e, "base64"), s = r, c = a;
		if (!s || c == null) try {
			let e = await u.stat(t);
			s = e.mtime.toISOString(), c = e.size;
		} catch {
			s = (/* @__PURE__ */ new Date()).toISOString(), c = 0;
		}
		let d = H(t, s, c), f = l.join(B, `${d}.jpg`);
		await u.mkdir(l.dirname(f), { recursive: !0 });
		let p = i.createFromBuffer(o);
		if (p.isEmpty()) return !1;
		let m = p.getSize(), h = p;
		if (m.width > 0 && m.height > 0 && m.width !== m.height) {
			let e = Math.min(m.width, m.height), t = Math.round((m.width - e) / 2), n = Math.round((m.height - e) / 2);
			h = p.crop({
				x: t,
				y: n,
				width: e,
				height: e
			});
		}
		let g = h.resize({
			width: 256,
			height: 256,
			quality: "best"
		}).toJPEG(85);
		return await u.writeFile(f, g), !0;
	} catch (e) {
		return console.error("save-thumbnail-cache failed:", e), !1;
	}
});
//#endregion
