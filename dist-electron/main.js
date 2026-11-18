import { BrowserWindow as e, Menu as t, app as n, dialog as r, ipcMain as i, nativeImage as a, protocol as o, safeStorage as s, screen as c, session as l, shell as u } from "electron";
import d from "node:path";
import f from "node:fs/promises";
import * as p from "node:fs";
import { Readable as m, Writable as h } from "node:stream";
import g from "node:os";
import ee from "node:crypto";
import { exec as te, execFile as ne, spawn as re } from "node:child_process";
import { promisify as ie } from "node:util";
import { fileURLToPath as ae } from "node:url";
import { Client as oe, FileType as _ } from "basic-ftp";
import se from "ssh2-sftp-client";
//#region electron/remote.ts
var ce = /^(sftp|ftps?):\/\/([^/]+)(\/.*)?$/i;
function v(e) {
	return typeof e == "string" && ce.test(e.trim());
}
function y(e) {
	let t = (e || "/").split("/").filter(Boolean), n = [];
	for (let e of t) e !== "." && (e === ".." ? n.pop() : n.push(e));
	return "/" + n.join("/");
}
function b(e) {
	if (!e || typeof e != "string") return null;
	let t = ce.exec(e.trim());
	return t ? {
		protocol: t[1].toLowerCase(),
		connectionId: t[2],
		remotePath: y(t[3] || "/")
	} : null;
}
function x(e, t, n) {
	return `${e}://${t}${y(n)}`;
}
function S(e, t) {
	let n = y(e);
	return n === "/" ? `/${t}` : `${n}/${t}`;
}
function C(e) {
	let t = y(e);
	if (t === "/") return "/";
	let n = t.lastIndexOf("/");
	return n <= 0 ? "/" : t.slice(0, n);
}
function w(e) {
	let t = y(e);
	if (t === "/") return "/";
	let n = t.lastIndexOf("/");
	return n >= 0 ? t.slice(n + 1) : t;
}
function le() {
	return d.join(n.getPath("userData"), "remote-connections.json");
}
function ue() {
	return d.join(g.tmpdir(), "jabro-remote-preview");
}
function de(e) {
	if (e) {
		try {
			if (s.isEncryptionAvailable()) return {
				method: "safeStorage",
				value: s.encryptString(e).toString("base64")
			};
		} catch (e) {
			console.warn("[Remote] safeStorage encrypt failed, using fallback encoding:", e);
		}
		return {
			method: "plain",
			value: Buffer.from(e, "utf8").toString("base64")
		};
	}
}
function fe(e) {
	if (!(!e || !e.value)) try {
		return e.method === "safeStorage" ? s.isEncryptionAvailable() ? s.decryptString(Buffer.from(e.value, "base64")) : void 0 : Buffer.from(e.value, "base64").toString("utf8");
	} catch (e) {
		console.warn("[Remote] decryptSecret failed:", e);
		return;
	}
}
var T = /* @__PURE__ */ new Map(), E = /* @__PURE__ */ new Map(), D = null;
async function O() {
	if (D) return D;
	let e = le();
	try {
		let t = await f.readFile(e, "utf8"), n = JSON.parse(t);
		D = Array.isArray(n) ? n : [];
	} catch {
		D = [];
	}
	return D;
}
async function pe(e) {
	D = e;
	let t = le();
	await f.mkdir(d.dirname(t), { recursive: !0 }), await f.writeFile(t, JSON.stringify(e, null, 2), "utf8");
}
function me(e) {
	return {
		id: e.id,
		name: e.name,
		protocol: e.protocol,
		host: e.host,
		port: e.port,
		username: e.username,
		authType: e.authType,
		privateKeyPath: e.privateKeyPath,
		initialPath: e.initialPath,
		rejectUnauthorized: e.rejectUnauthorized,
		hasPassword: !!e.password?.value,
		hasPassphrase: !!e.passphrase?.value,
		connected: T.has(e.id),
		lastError: E.get(e.id),
		createdAt: e.createdAt
	};
}
async function he() {
	return (await O()).map(me);
}
async function ge(e) {
	let t = await O(), n = e.id ? t.find((t) => t.id === e.id) : void 0, r = n?.id || e.id || `srv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, i = e.protocol || "sftp", a = i === "sftp" ? 22 : 21, o = Number(e.port) > 0 ? Number(e.port) : a, s = e.password ? de(e.password) : e.keepExistingSecrets && n ? n.password : void 0, c = e.passphrase ? de(e.passphrase) : e.keepExistingSecrets && n ? n.passphrase : void 0, l = {
		id: r,
		name: (e.name || e.host || "Remote Server").trim(),
		protocol: i,
		host: (e.host || "").trim(),
		port: o,
		username: (e.username || "").trim(),
		authType: i === "sftp" && e.authType || "password",
		password: s,
		privateKeyPath: e.privateKeyPath?.trim() || void 0,
		passphrase: c,
		initialPath: e.initialPath?.trim() || "/",
		rejectUnauthorized: !!e.rejectUnauthorized,
		createdAt: n?.createdAt || (/* @__PURE__ */ new Date()).toISOString()
	};
	return n && await M(r), E.delete(r), await pe(n ? t.map((e) => e.id === r ? l : e) : [...t, l]), me(l);
}
async function _e(e) {
	return await M(e), E.delete(e), await pe((await O()).filter((t) => t.id !== e)), !0;
}
async function k(e) {
	let t = await O(), n = e.id ? t.find((t) => t.id === e.id) : void 0, r = e.password || (e.keepExistingSecrets && n ? fe(n.password) : void 0), i = e.passphrase || (e.keepExistingSecrets && n ? fe(n.passphrase) : void 0), a = e.protocol || "sftp";
	return {
		protocol: a,
		host: (e.host || "").trim(),
		port: Number(e.port) > 0 ? Number(e.port) : a === "sftp" ? 22 : 21,
		username: (e.username || "").trim(),
		authType: a === "sftp" && e.authType || "password",
		password: r,
		privateKeyPath: e.privateKeyPath?.trim() || n?.privateKeyPath,
		passphrase: i,
		initialPath: e.initialPath?.trim() || "/",
		rejectUnauthorized: !!e.rejectUnauthorized
	};
}
async function A(e) {
	if (!e.host) throw Error("Host is required.");
	if (e.protocol === "sftp") {
		let t = new se(), n = {
			host: e.host,
			port: e.port,
			username: e.username || void 0,
			readyTimeout: 15e3,
			retries: 1
		};
		if (e.authType === "privateKey") {
			if (!e.privateKeyPath) throw Error("Private key file path is required for key authentication.");
			n.privateKey = await f.readFile(e.privateKeyPath), e.passphrase && (n.passphrase = e.passphrase);
		} else e.authType === "agent" ? (n.agent = process.env.SSH_AUTH_SOCK, !n.agent && process.platform === "win32" && (n.agent = "pageant")) : n.password = e.password || "";
		await t.connect(n);
		let r = y(e.initialPath || "/");
		try {
			!e.initialPath || e.initialPath === "." || e.initialPath === "~" ? r = y(await t.cwd()) : await t.exists(r) || (r = y(await t.cwd()));
		} catch {
			r = "/";
		}
		return {
			sftp: t,
			resolvedInitialPath: r
		};
	}
	let t = new oe(2e4);
	await t.access({
		host: e.host,
		port: e.port,
		user: e.username || "anonymous",
		password: e.password || "anonymous@",
		secure: e.protocol === "ftps",
		secureOptions: e.protocol === "ftps" ? { rejectUnauthorized: e.rejectUnauthorized } : void 0
	});
	let n = y(e.initialPath || "/");
	try {
		!e.initialPath || e.initialPath === "." || await t.cd(n), n = y(await t.pwd());
	} catch {
		try {
			n = y(await t.pwd());
		} catch {
			n = "/";
		}
	}
	return {
		ftp: t,
		resolvedInitialPath: n
	};
}
async function ve(e) {
	let t = await k(e), n = null;
	try {
		return n = await A(t), {
			success: !0,
			resolvedPath: n.resolvedInitialPath
		};
	} catch (e) {
		return {
			success: !1,
			error: e?.message || String(e)
		};
	} finally {
		try {
			await n?.sftp?.end();
		} catch {}
		try {
			n?.ftp?.close();
		} catch {}
	}
}
async function ye(e) {
	let t = (await O()).find((t) => t.id === e);
	if (!t) throw Error(`Remote server "${e}" was not found.`);
	return t;
}
async function be(e) {
	let t = await A(await k({
		id: e.id,
		name: e.name,
		protocol: e.protocol,
		host: e.host,
		port: e.port,
		username: e.username,
		authType: e.authType,
		privateKeyPath: e.privateKeyPath,
		initialPath: e.initialPath,
		rejectUnauthorized: e.rejectUnauthorized,
		keepExistingSecrets: !0
	})), n = {
		connectionId: e.id,
		protocol: e.protocol,
		sftp: t.sftp,
		ftp: t.ftp,
		queue: Promise.resolve()
	};
	return T.set(e.id, n), E.delete(e.id), n;
}
async function xe(e) {
	let t = T.get(e);
	if (t) {
		if (t.protocol === "sftp" && t.sftp || (t.protocol === "ftp" || t.protocol === "ftps") && t.ftp && !t.ftp.closed) return t;
		T.delete(e);
	}
	let n = await ye(e);
	try {
		return await be(n);
	} catch (t) {
		throw E.set(e, t?.message || String(t)), t;
	}
}
async function j(e, t) {
	let n = await xe(e), r = async () => {
		try {
			return await t(n);
		} catch (r) {
			let i = String(r?.message || r || "");
			if (!(n.ftp && n.ftp.closed || /No SFTP connection|Not connected|ECONNRESET|EPIPE|ETIMEDOUT|Connection lost|closed|socket/i.test(i))) throw r;
			return await M(e), n = await xe(e), await t(n);
		}
	}, i = n.queue.then(r, r);
	return n.queue = i.catch(() => {}), i;
}
async function Se(e) {
	try {
		let t = await ye(e);
		await M(e);
		let n = await A(await k({
			id: t.id,
			name: t.name,
			protocol: t.protocol,
			host: t.host,
			port: t.port,
			username: t.username,
			authType: t.authType,
			privateKeyPath: t.privateKeyPath,
			initialPath: t.initialPath,
			rejectUnauthorized: t.rejectUnauthorized,
			keepExistingSecrets: !0
		})), r = {
			connectionId: t.id,
			protocol: t.protocol,
			sftp: n.sftp,
			ftp: n.ftp,
			queue: Promise.resolve()
		};
		return T.set(t.id, r), E.delete(t.id), {
			success: !0,
			rootUri: x(t.protocol, t.id, "/"),
			initialUri: x(t.protocol, t.id, n.resolvedInitialPath)
		};
	} catch (t) {
		let n = t?.message || String(t);
		return E.set(e, n), {
			success: !1,
			error: n
		};
	}
}
async function M(e) {
	let t = T.get(e);
	if (t) {
		T.delete(e);
		try {
			await t.sftp?.end();
		} catch {}
		try {
			t.ftp?.close();
		} catch {}
	}
}
async function Ce() {
	let e = Array.from(T.keys());
	await Promise.all(e.map((e) => M(e)));
}
function we(e) {
	if (e) return `${e.user || "---"}${e.group || "---"}${e.other || "---"}`;
}
async function Te(e) {
	let t = b(e);
	if (!t) throw Error(`Invalid remote URI: ${e}`);
	return j(t.connectionId, async (e) => {
		let n = [];
		if (e.sftp) {
			let r = await e.sftp.list(t.remotePath);
			for (let i of r) {
				if (!i.name || i.name === "." || i.name === "..") continue;
				let r = S(t.remotePath, i.name), a = i.type === "d", o = i.size;
				if (i.type === "l") try {
					let t = await e.sftp.stat(r);
					a = t.isDirectory, o = t.size;
				} catch {}
				let s = a ? void 0 : d.posix.extname(i.name).toLowerCase() || void 0;
				n.push({
					name: i.name,
					path: x(t.protocol, t.connectionId, r),
					isDirectory: a,
					size: a ? void 0 : o,
					mtime: new Date(i.modifyTime || Date.now()).toISOString(),
					ext: s,
					permissions: we(i.rights)
				});
			}
			return n;
		}
		if (e.ftp) {
			let r = await e.ftp.list(t.remotePath);
			for (let e of r) {
				if (!e.name || e.name === "." || e.name === "..") continue;
				let r = e.isDirectory || e.type === _.Directory, i = S(t.remotePath, e.name), a = r ? void 0 : d.posix.extname(e.name).toLowerCase() || void 0;
				n.push({
					name: e.name,
					path: x(t.protocol, t.connectionId, i),
					isDirectory: r,
					size: r ? void 0 : e.size ?? 0,
					mtime: (e.modifiedAt || /* @__PURE__ */ new Date()).toISOString(),
					ext: a
				});
			}
			return n;
		}
		throw Error("Remote session is not initialized.");
	});
}
async function Ee(e) {
	let t = b(e);
	if (!t) throw Error(`Invalid remote URI: ${e}`);
	return j(t.connectionId, async (e) => {
		let n = 0, r = 0, i = 0, a = /* @__PURE__ */ new Set(), o = [t.remotePath];
		for (; o.length > 0;) {
			let t = o.pop();
			if (!a.has(t)) {
				if (a.add(t), e.sftp) {
					let a = [];
					try {
						a = await e.sftp.list(t);
					} catch {
						continue;
					}
					for (let e of a) {
						if (!e.name || e.name === "." || e.name === ".." || e.type === "l") continue;
						let a = S(t, e.name);
						e.type === "d" ? (i++, o.push(a)) : (r++, n += e.size || 0);
					}
				} else if (e.ftp) {
					let a = [];
					try {
						a = await e.ftp.list(t);
					} catch {
						continue;
					}
					for (let e of a) {
						if (!e.name || e.name === "." || e.name === ".." || e.isSymbolicLink) continue;
						let a = S(t, e.name);
						e.isDirectory || e.type === _.Directory ? (i++, o.push(a)) : (r++, n += e.size || 0);
					}
				}
			}
		}
		return {
			size: n,
			fileCount: r,
			dirCount: i
		};
	});
}
async function De(e, t) {
	let n = b(e);
	if (!n) throw Error(`Invalid remote URI: ${e}`);
	return j(n.connectionId, async (e) => {
		let r = /* @__PURE__ */ new Set();
		if (e.sftp) {
			let t = await e.sftp.list(n.remotePath);
			for (let e of t) r.add(e.name);
		} else if (e.ftp) {
			let t = await e.ftp.list(n.remotePath);
			for (let e of t) r.add(e.name);
		}
		let i = (t || "New folder").trim(), a = i, o = 1;
		for (; r.has(a);) a = `${i} (${o})`, o++;
		let s = S(n.remotePath, a);
		if (e.sftp) await e.sftp.mkdir(s, !0);
		else if (e.ftp) {
			let t = await e.ftp.pwd().catch(() => "/");
			await e.ftp.ensureDir(s), await e.ftp.cd(t).catch(() => {});
		}
		return x(n.protocol, n.connectionId, s);
	});
}
async function Oe(e, t) {
	let n = b(e);
	if (!n) throw Error(`Invalid remote URI: ${e}`);
	let r = t.trim().replace(/[\\/]/g, "");
	if (!r || r === "." || r === "..") throw Error("Invalid file or folder name.");
	let i = S(C(n.remotePath), r), a = x(n.protocol, n.connectionId, i);
	return i === n.remotePath || await j(n.connectionId, async (e) => {
		if (e.sftp) {
			if (await e.sftp.exists(i)) throw Error(`An item named "${r}" already exists.`);
			await e.sftp.rename(n.remotePath, i);
		} else e.ftp && await e.ftp.rename(n.remotePath, i);
	}), {
		success: !0,
		oldPath: e,
		newPath: a
	};
}
async function N(e, t) {
	if (e.sftp) {
		let n = await e.sftp.exists(t);
		if (!n) return;
		n === "d" ? await e.sftp.rmdir(t, !0) : await e.sftp.delete(t);
		return;
	}
	if (e.ftp) {
		let n = C(t), r = w(t), i = (await e.ftp.list(n)).find((e) => e.name === r);
		i && (i.isDirectory || i.type === _.Directory) ? await e.ftp.removeDir(t) : await e.ftp.remove(t);
	}
}
async function ke(e) {
	let t = [], n = [];
	for (let r of e) {
		let e = b(r), i = w(e?.remotePath || r);
		if (!e) {
			let e = `Invalid remote path: ${r}`;
			n.push(e), t.push({
				path: r,
				name: i,
				success: !1,
				error: e
			});
			continue;
		}
		try {
			await j(e.connectionId, async (t) => {
				await N(t, e.remotePath);
			}), t.push({
				path: r,
				name: i,
				success: !0
			});
		} catch (e) {
			let a = e?.message || String(e);
			n.push(`Failed to delete "${i}": ${a}`), t.push({
				path: r,
				name: i,
				success: !1,
				error: a
			});
		}
	}
	let r = t.filter((e) => e.success).length, i = t.length - r, a = i === 0 ? r === 1 ? `Deleted "${t[0].name}" from server` : `Deleted ${r} items from server` : `Deleted ${r} of ${t.length} items (${i} failed).`;
	return {
		success: i === 0,
		items: t,
		summary: a,
		errors: n
	};
}
async function Ae(e, t, n) {
	let r = [], i = 0, a = new h({ write(e, t, a) {
		let o = Buffer.isBuffer(e) ? e : Buffer.from(e);
		if (n && i + o.length > n) {
			a(/* @__PURE__ */ Error("FILE_TOO_LARGE"));
			return;
		}
		i += o.length, r.push(o), a();
	} });
	return await e.downloadTo(a, t), Buffer.concat(r);
}
async function je(e, t = 1024 * 1024) {
	let n = b(e);
	if (!n) throw Error(`Invalid remote URI: ${e}`);
	return j(n.connectionId, async (e) => {
		if (e.sftp) {
			if ((await e.sftp.stat(n.remotePath)).size > t) return "[File too large to preview as text. Download or \"Save as...\" to inspect locally.]";
			let r = await e.sftp.get(n.remotePath);
			return Buffer.isBuffer(r) ? r.toString("utf8") : String(r || "");
		}
		if (e.ftp) try {
			return await e.ftp.size(n.remotePath).catch(() => 0) > t ? "[File too large to preview as text. Download or \"Save as...\" to inspect locally.]" : (await Ae(e.ftp, n.remotePath, t)).toString("utf8");
		} catch (e) {
			if (e?.message === "FILE_TOO_LARGE") return "[File too large to preview as text. Download or \"Save as...\" to inspect locally.]";
			throw e;
		}
		throw Error("Remote session unavailable.");
	});
}
async function Me(e, t, n) {
	let r = b(e);
	if (!r) throw Error(`Invalid remote URI: ${e}`);
	await f.mkdir(d.dirname(t), { recursive: !0 });
	let i = w(r.remotePath);
	await j(r.connectionId, async (e) => {
		if (e.sftp) {
			let a = -1;
			await e.sftp.fastGet(r.remotePath, t, { step: (e, t, r) => {
				if (n && r > 0) {
					let t = Math.floor(e / r * 100);
					t !== a && (t % 5 == 0 || t === 100) && (a = t, n({
						line: `Downloading ${i} (${t}%)`,
						fileName: i,
						phase: "downloading"
					}));
				}
			} });
		} else if (e.ftp) {
			e.ftp.trackProgress((e) => {
				n && n({
					line: `Downloading ${i} (${Math.round(e.bytes / 1024)} KB)...`,
					fileName: i,
					phase: "downloading"
				});
			});
			try {
				await e.ftp.downloadTo(t, r.remotePath);
			} finally {
				e.ftp.trackProgress();
			}
		}
	});
}
async function P(e) {
	let t = b(e);
	if (!t) throw Error(`Invalid remote URI: ${e}`);
	let n = ue();
	await f.mkdir(n, { recursive: !0 });
	let r = ee.createHash("sha1").update(e).digest("hex").slice(0, 12), i = w(t.remotePath).replace(/[<>:"/\\|?*]/g, "_"), a = d.join(n, `${r}_${i}`);
	return await Me(e, a), a;
}
async function Ne(e, t, n, r) {
	let i = d.basename(t);
	if (e.sftp) {
		let a = -1;
		await e.sftp.fastPut(t, n, { step: (e, t, n) => {
			if (r && n > 0) {
				let t = Math.floor(e / n * 100);
				t !== a && (t % 5 == 0 || t === 100) && (a = t, r({
					line: `Uploading ${i} (${t}%)`,
					fileName: i,
					phase: "uploading"
				}));
			}
		} });
	} else if (e.ftp) {
		e.ftp.trackProgress((e) => {
			r && r({
				line: `Uploading ${i} (${Math.round(e.bytes / 1024)} KB)...`,
				fileName: i,
				phase: "uploading"
			});
		});
		try {
			await e.ftp.uploadFrom(t, n);
		} finally {
			e.ftp.trackProgress();
		}
	}
}
async function F(e, t, n, r) {
	let i = /* @__PURE__ */ new Set();
	try {
		if (e.sftp) {
			let n = await e.sftp.list(t);
			for (let e of n) i.add(e.name);
		} else if (e.ftp) {
			let n = await e.ftp.list(t);
			for (let e of n) i.add(e.name);
		}
	} catch {}
	if (!i.has(n) && !r) return S(t, n);
	let a = d.posix.extname(n), o = a ? n.slice(0, -a.length) : n, s = r ? `${o} - Copy${a}` : n, c = 2;
	for (; i.has(s);) s = r ? `${o} - Copy (${c})${a}` : `${o} (${c})${a}`, c++;
	return S(t, s);
}
async function I(e, t, n, r) {
	if ((await f.stat(t)).isDirectory()) {
		if (e.sftp) await e.sftp.mkdir(n, !0);
		else if (e.ftp) {
			let t = await e.ftp.pwd().catch(() => "/");
			await e.ftp.ensureDir(n), await e.ftp.cd(t).catch(() => {});
		}
		let i = await f.readdir(t);
		for (let a of i) await I(e, d.join(t, a), S(n, a), r);
	} else await Ne(e, t, n, r);
}
async function L(e, t, n, r, i, a) {
	let o = !1;
	if (e.sftp) o = (await e.sftp.stat(r)).isDirectory;
	else if (e.ftp) {
		let t = C(r), n = w(r), i = (await e.ftp.list(t)).find((e) => e.name === n);
		o = !!(i && (i.isDirectory || i.type === _.Directory));
	}
	if (o) {
		await f.mkdir(i, { recursive: !0 });
		let o = [];
		e.sftp ? o = (await e.sftp.list(r)).filter((e) => e.name !== "." && e.name !== "..").map((e) => e.name) : e.ftp && (o = (await e.ftp.list(r)).filter((e) => e.name !== "." && e.name !== "..").map((e) => e.name));
		for (let s of o) await L(e, t, n, S(r, s), d.join(i, s), a);
	} else {
		await f.mkdir(d.dirname(i), { recursive: !0 });
		let t = w(r);
		if (e.sftp) {
			let n = -1;
			await e.sftp.fastGet(r, i, { step: (e, r, i) => {
				if (a && i > 0) {
					let r = Math.floor(e / i * 100);
					r !== n && (r % 5 == 0 || r === 100) && (n = r, a({
						line: `Downloading ${t} (${r}%)`,
						fileName: t,
						phase: "downloading"
					}));
				}
			} });
		} else if (e.ftp) {
			e.ftp.trackProgress((e) => {
				a && a({
					line: `Downloading ${t} (${Math.round(e.bytes / 1024)} KB)...`,
					fileName: t,
					phase: "downloading"
				});
			});
			try {
				await e.ftp.downloadTo(i, r);
			} finally {
				e.ftp.trackProgress();
			}
		}
	}
}
async function R(e, t, n, r, i) {
	let a = b(t);
	if (!a) throw Error(`Invalid remote target URI: ${t}`);
	let o = [], s = [];
	for (let t = 0; t < e.length; t++) {
		let c = e[t], l = d.basename(c);
		i?.({
			line: `${n ? "Moving" : "Uploading"} ${l} (${t + 1}/${e.length})...`,
			current: t + 1,
			total: e.length,
			fileName: l,
			phase: "uploading"
		});
		try {
			await f.access(c);
			let e = await j(a.connectionId, async (e) => {
				let t = await F(e, a.remotePath, l, !1);
				return await I(e, c, t, i), x(a.protocol, a.connectionId, t);
			});
			n && await r(c), o.push({
				src: c,
				dest: e,
				name: w(e),
				success: !0
			});
		} catch (e) {
			let t = e?.message || String(e);
			s.push(`Failed to upload "${l}": ${t}`), o.push({
				src: c,
				name: l,
				success: !1,
				error: t
			});
		}
	}
	let c = o.filter((e) => e.success).length, l = o.length - c, u = l === 0 ? c === 1 ? `Uploaded "${o[0].name}"` : `Uploaded ${c} items` : `Uploaded ${c} of ${o.length} items (${l} failed).`;
	return i?.({
		line: u,
		phase: l === 0 ? "complete" : "partial",
		success: l === 0,
		errors: s
	}), {
		success: l === 0,
		type: n ? "move" : "copy",
		target: t,
		items: o,
		summary: u,
		errors: s
	};
}
async function z(e, t, n, r, i) {
	await f.mkdir(t, { recursive: !0 });
	let a = [], o = [];
	for (let s = 0; s < e.length; s++) {
		let c = e[s], l = b(c), u = w(l?.remotePath || c);
		if (i?.({
			line: `${n ? "Moving" : "Downloading"} ${u} (${s + 1}/${e.length})...`,
			current: s + 1,
			total: e.length,
			fileName: u,
			phase: "downloading"
		}), !l) {
			let e = `Invalid remote URI: ${c}`;
			o.push(e), a.push({
				src: c,
				name: u,
				success: !1,
				error: e
			});
			continue;
		}
		try {
			let e = await r(t, u, !1);
			await j(l.connectionId, async (t) => {
				await L(t, l.protocol, l.connectionId, l.remotePath, e, i), n && await N(t, l.remotePath);
			}), a.push({
				src: c,
				dest: e,
				name: d.basename(e),
				success: !0
			});
		} catch (e) {
			let t = e?.message || String(e);
			o.push(`Failed to download "${u}": ${t}`), a.push({
				src: c,
				name: u,
				success: !1,
				error: t
			});
		}
	}
	let s = a.filter((e) => e.success).length, c = a.length - s, l = c === 0 ? s === 1 ? `Downloaded "${a[0].name}"` : `Downloaded ${s} items` : `Downloaded ${s} of ${a.length} items (${c} failed).`;
	return i?.({
		line: l,
		phase: c === 0 ? "complete" : "partial",
		success: c === 0,
		errors: o
	}), {
		success: c === 0,
		type: n ? "move" : "copy",
		target: t,
		items: a,
		summary: l,
		errors: o
	};
}
async function B(e, t, n, r) {
	let i = b(t);
	if (!i) throw Error(`Invalid remote target URI: ${t}`);
	let a = [], o = [];
	for (let t = 0; t < e.length; t++) {
		let s = e[t], c = b(s), l = w(c?.remotePath || s);
		if (r?.({
			line: `${n ? "Moving" : "Copying"} ${l} (${t + 1}/${e.length})...`,
			current: t + 1,
			total: e.length,
			fileName: l,
			phase: n ? "moving" : "copying"
		}), !c) {
			let e = `Invalid remote URI: ${s}`;
			o.push(e), a.push({
				src: s,
				name: l,
				success: !1,
				error: e
			});
			continue;
		}
		try {
			let e = c.connectionId === i.connectionId, t = e && C(c.remotePath) === i.remotePath;
			if (e && n && t) {
				a.push({
					src: s,
					dest: s,
					name: l,
					success: !0
				});
				continue;
			}
			if (e && n) {
				let e = await j(i.connectionId, async (e) => {
					let t = await F(e, i.remotePath, l, !1);
					return e.sftp ? await e.sftp.rename(c.remotePath, t) : e.ftp && await e.ftp.rename(c.remotePath, t), x(i.protocol, i.connectionId, t);
				});
				a.push({
					src: s,
					dest: e,
					name: w(e),
					success: !0
				});
			} else {
				let e = await f.mkdtemp(d.join(g.tmpdir(), "jabro-relay-"));
				try {
					let o = d.join(e, l);
					await j(c.connectionId, async (e) => {
						await L(e, c.protocol, c.connectionId, c.remotePath, o, r);
					});
					let u = await j(i.connectionId, async (e) => {
						let n = await F(e, i.remotePath, l, t);
						return await I(e, o, n, r), x(i.protocol, i.connectionId, n);
					});
					n && await j(c.connectionId, async (e) => {
						await N(e, c.remotePath);
					}), a.push({
						src: s,
						dest: u,
						name: w(u),
						success: !0
					});
				} finally {
					try {
						await f.rm(e, {
							recursive: !0,
							force: !0
						});
					} catch {}
				}
			}
		} catch (e) {
			let t = e?.message || String(e);
			o.push(`Failed to ${n ? "move" : "copy"} "${l}": ${t}`), a.push({
				src: s,
				name: l,
				success: !1,
				error: t
			});
		}
	}
	let s = a.filter((e) => e.success).length, c = a.length - s, l = c === 0 ? s === 1 ? `${n ? "Moved" : "Copied"} "${a[0].name}"` : `${n ? "Moved" : "Copied"} ${s} items` : `${n ? "Moved" : "Copied"} ${s} of ${a.length} items (${c} failed).`;
	return r?.({
		line: l,
		phase: c === 0 ? "complete" : "partial",
		success: c === 0,
		errors: o
	}), {
		success: c === 0,
		type: n ? "move" : "copy",
		target: t,
		items: a,
		summary: l,
		errors: o
	};
}
async function Pe() {
	try {
		let e = ue();
		p.existsSync(e) && await f.rm(e, {
			recursive: !0,
			force: !0
		});
	} catch {}
}
//#endregion
//#region electron/main.ts
var Fe = ie(te), Ie = ie(ne), Le = ae(import.meta.url), V = d.dirname(Le);
n.setName("JabroFiles"), n.commandLine.appendSwitch("enable-features", "SharedArrayBuffer"), n.commandLine.appendSwitch("allow-file-access-from-files"), n.commandLine.appendSwitch("disable-geolocation"), n.commandLine.appendSwitch("disable-background-networking"), n.commandLine.appendSwitch("disable-features", "Geolocation,WebBluetooth,WebUSB,MediaRouter"), o.registerSchemesAsPrivileged([{
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
function Re() {
	return n.isPackaged ? d.join(process.resourcesPath, "app.asar", "dist-electron", "preload.js") : d.join(V, "preload.js");
}
function ze() {
	return n.isPackaged ? d.join(process.resourcesPath, "app.asar", "dist", "index.html") : d.join(V, "../dist/index.html");
}
function Be() {
	return n.isPackaged ? d.join(process.resourcesPath, "app.asar", "dist", "app-icon.png") : d.join(V, "../public/app-icon.png");
}
function H(e) {
	U && !U.isDestroyed() && U.webContents.send("menu-action", e);
}
function Ve() {
	let e = process.platform === "darwin", n = [
		...e ? [{
			label: "JabroFiles",
			submenu: [
				{
					role: "about",
					label: "About JabroFiles"
				},
				{ type: "separator" },
				{ role: "services" },
				{ type: "separator" },
				{
					role: "hide",
					label: "Hide JabroFiles"
				},
				{ role: "hideOthers" },
				{ role: "unhide" },
				{ type: "separator" },
				{
					role: "quit",
					label: "Quit JabroFiles"
				}
			]
		}] : [],
		{
			label: "File",
			submenu: [
				{
					label: "New Tab",
					accelerator: "CmdOrCtrl+T",
					click: () => H("new-tab")
				},
				{
					label: "Open Folder…",
					accelerator: "CmdOrCtrl+O",
					click: () => H("open-folder")
				},
				{
					label: "New Folder",
					accelerator: "CmdOrCtrl+Shift+N",
					click: () => H("new-folder")
				},
				{ type: "separator" },
				{
					label: "Connect FTP / SFTP Server…",
					accelerator: "CmdOrCtrl+K",
					click: () => H("connect-remote")
				},
				{ type: "separator" },
				{
					label: "Close Tab",
					accelerator: "CmdOrCtrl+W",
					click: () => H("close-tab")
				},
				e ? {
					role: "close",
					label: "Close Window"
				} : {
					role: "quit",
					label: "Exit JabroFiles"
				}
			]
		},
		{
			label: "Edit",
			submenu: [
				{ role: "undo" },
				{ role: "redo" },
				{ type: "separator" },
				{ role: "cut" },
				{ role: "copy" },
				{ role: "paste" },
				{ role: "selectAll" }
			]
		},
		{
			label: "View",
			submenu: [
				{
					label: "Refresh",
					accelerator: "F5",
					click: () => H("refresh")
				},
				{
					label: "Calculate Folder Sizes",
					accelerator: "CmdOrCtrl+R",
					click: () => H("calc-sizes")
				},
				{ type: "separator" },
				{
					label: "Toggle Sidebar",
					accelerator: "CmdOrCtrl+B",
					click: () => H("toggle-sidebar")
				},
				{
					label: "Toggle Split View",
					accelerator: "CmdOrCtrl+\\",
					click: () => H("toggle-split")
				},
				{ type: "separator" },
				{
					role: "reload",
					label: "Reload App Window",
					accelerator: "CmdOrCtrl+Shift+R"
				},
				{ role: "toggleDevTools" },
				{ type: "separator" },
				{ role: "resetZoom" },
				{ role: "zoomIn" },
				{ role: "zoomOut" },
				{ type: "separator" },
				{ role: "togglefullscreen" }
			]
		},
		{
			label: "Window",
			submenu: [
				{ role: "minimize" },
				{ role: "zoom" },
				...e ? [{ type: "separator" }, { role: "front" }] : [{ role: "close" }]
			]
		}
	];
	return t.buildFromTemplate(n);
}
var U = null, W = () => d.join(n.getPath("userData"), "window-bounds.json");
function He() {
	try {
		if (p.existsSync(W())) {
			let e = p.readFileSync(W(), "utf8"), t = JSON.parse(e);
			if (t && typeof t.width == "number" && typeof t.height == "number") {
				if (t.width < 400 || t.height < 300 || t.x !== void 0 && (t.x < -1e4 || t.y < -1e4)) return null;
				try {
					if (!c.getAllDisplays().some((e) => {
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
function Ue(e) {
	try {
		if (!e || e.isDestroyed() || e.isMinimized()) return;
		let t = {
			...e.isMaximized() && e.getNormalBounds ? e.getNormalBounds() : e.getBounds(),
			isMaximized: e.isMaximized()
		};
		p.writeFileSync(W(), JSON.stringify(t));
	} catch {}
}
function We() {
	let t = He(), n = Be(), r = {
		width: 1180,
		height: 780,
		minWidth: 820,
		minHeight: 520,
		backgroundColor: "#0f0f10",
		title: "JabroFiles",
		...p.existsSync(n) ? { icon: n } : {},
		titleBarStyle: "hidden",
		titleBarOverlay: {
			color: "#18181b",
			symbolColor: "#a1a1aa",
			height: 40
		},
		...process.platform === "darwin" ? { trafficLightPosition: {
			x: 14,
			y: 13
		} } : {},
		webPreferences: {
			preload: Re(),
			contextIsolation: !0,
			nodeIntegration: !1,
			webSecurity: !1
		}
	};
	t && (r.x = t.x, r.y = t.y, r.width = t.width, r.height = t.height), U = new e(r), t && t.isMaximized && U.maximize();
	let i = process.env.VITE_DEV_SERVER_URL;
	if (i) {
		let e = () => {
			U?.loadURL(i).catch((t) => {
				console.warn("[Main] Dev server connect failed, retrying in 350ms...", t), setTimeout(() => {
					U && !U.isDestroyed() && e();
				}, 350);
			});
		};
		e();
	} else U.loadFile(ze()).catch((e) => {
		console.error("[Main] Failed to load index.html:", e);
	});
	U.webContents.on("did-fail-load", (e, t, n, r) => {
		console.warn(`[Main] did-fail-load: ${n} (${t}) for ${r}`), i && r && r.includes("localhost") && setTimeout(() => {
			U && !U.isDestroyed() && (console.log("[Main] Dev server retry on did-fail-load..."), U.loadURL(i).catch(() => {}));
		}, 500);
	}), U.webContents.on("render-process-gone", (e, t) => {
		console.error("[Main] Render process gone:", t), t.reason !== "clean-exit" && U && !U.isDestroyed() && U.reload();
	}), U.webContents.on("console-message", ({ level: e, message: t, lineNumber: n, sourceId: r }) => {
		console.log(`[Renderer LOG ${e}] ${t} (${r}:${n})`);
	}), U.on("moved", () => Ue(U)), U.on("resized", () => Ue(U)), U.on("close", () => Ue(U)), U.on("closed", () => {
		U = null;
	});
}
i.on("get-home-dir", (e) => {
	e.returnValue = g.homedir();
}), n.whenReady().then(() => {
	l.defaultSession.webRequest.onHeadersReceived((e, t) => {
		let n = { ...e.responseHeaders };
		e.resourceType === "mainFrame" && !e.url.startsWith("chrome-extension:") && (n["Cross-Origin-Opener-Policy"] = ["same-origin"], n["Cross-Origin-Embedder-Policy"] = ["credentialless"]), t({ responseHeaders: n });
	}), l.defaultSession.setPermissionRequestHandler((e, t, n) => {
		let r = t;
		if ([
			"geolocation",
			"geolocation-approximate",
			"sensors",
			"notifications",
			"media"
		].includes(r)) return n(!1);
		n(!0);
	}), l.defaultSession.setPermissionCheckHandler((e, t) => {
		let n = t;
		return ![
			"geolocation",
			"geolocation-approximate",
			"sensors",
			"notifications",
			"media"
		].includes(n);
	}), o.handle("jabro-media", async (e) => {
		let t = "";
		try {
			let n = new URL(e.url);
			if (t = n.searchParams.get("path") || "", !t) {
				let e = decodeURIComponent(n.pathname);
				process.platform === "win32" && e.startsWith("/") && /^[a-zA-Z]:/.test(e.slice(1)) && (e = e.slice(1)), t = e;
			}
			t && (v(t) ? t = await P(t) : ((t.startsWith("\\\\?\\") || t.startsWith("//?/")) && (t = t.slice(4)), t = d.normalize(t)));
			let r = await f.stat(t), i = d.extname(t).toLowerCase(), a = new Headers(), o = "";
			i === ".pdf" ? o = "application/pdf" : i === ".jpg" || i === ".jpeg" ? o = "image/jpeg" : i === ".png" ? o = "image/png" : i === ".webp" ? o = "image/webp" : i === ".gif" ? o = "image/gif" : i === ".svg" ? o = "image/svg+xml" : i === ".bmp" ? o = "image/bmp" : i === ".ico" ? o = "image/x-icon" : i === ".tga" ? o = "image/x-tga" : i === ".dds" ? o = "image/vnd-ms.dds" : i === ".glb" ? o = "model/gltf-binary" : i === ".gltf" ? o = "model/gltf+json" : i === ".wasm" ? o = "application/wasm" : i === ".js" ? o = "application/javascript" : i === ".obj" ? o = "text/plain" : (i === ".stl" || i === ".ply" || i === ".splat" || i === ".ksplat" || i === ".spz" || i === ".fbx") && (o = "application/octet-stream"), o && a.set("content-type", o), a.set("access-control-allow-origin", "*"), a.set("access-control-expose-headers", "Content-Length, Content-Range, Accept-Ranges"), a.set("accept-ranges", "bytes"), a.set("Cross-Origin-Resource-Policy", "cross-origin");
			let s = e.headers.get("range"), c = 200, l;
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
						a.set("content-length", o.toString()), a.set("content-range", `bytes ${n}-${e}/${r.size}`), c = 206, l = p.createReadStream(t, {
							start: n,
							end: e
						});
					} else a.set("content-length", r.size.toString()), l = p.createReadStream(t);
				} else a.set("content-length", r.size.toString()), l = p.createReadStream(t);
			} else a.set("content-length", r.size.toString()), l = p.createReadStream(t);
			let u = m.toWeb(l);
			return new Response(u, {
				status: c,
				headers: a
			});
		} catch (e) {
			return console.error("jabro-media protocol error for path:", t, e), new Response("File not found: " + (e?.message || "Not found"), { status: 404 });
		}
	}), i.handle("detect-ply-type", async (e, t) => {
		try {
			let e = v(t) ? await P(t) : t, n = await f.open(e, "r"), r = Buffer.alloc(4096), { bytesRead: i } = await n.read(r, 0, 4096, 0);
			await n.close();
			let a = r.toString("utf8", 0, i);
			return a.includes("f_dc_") || a.includes("opacity") || a.includes("scale_0") || a.includes("rot_0") || a.includes("packed_position") ? "gaussian-splat" : "3d";
		} catch (e) {
			return console.error("detect-ply-type error:", e), "3d";
		}
	});
	let r = Be();
	if (p.existsSync(r)) {
		let e = a.createFromPath(r);
		!e.isEmpty() && process.platform === "darwin" && n.dock && n.dock.setIcon(e), n.setAboutPanelOptions({
			applicationName: "JabroFiles",
			applicationVersion: n.getVersion(),
			copyright: "JabroFiles",
			iconPath: r
		});
	} else n.setAboutPanelOptions({
		applicationName: "JabroFiles",
		applicationVersion: n.getVersion(),
		copyright: "JabroFiles"
	});
	t.setApplicationMenu(Ve()), We(), n.on("activate", () => {
		e.getAllWindows().length === 0 && We();
	});
}), n.on("window-all-closed", () => {
	process.platform !== "darwin" && n.quit();
}), n.on("before-quit", () => {
	Ce().catch(() => {}), Pe().catch(() => {});
}), i.handle("list-directory", async (e, t) => {
	if (v(t)) return Te(t);
	try {
		let e = await f.readdir(t, { withFileTypes: !0 }), n = [];
		for (let r of e) {
			if (r.name.startsWith("._")) continue;
			let e = d.join(t, r.name), i = r.isDirectory(), a = i ? void 0 : d.extname(r.name).toLowerCase() || void 0, o = (/* @__PURE__ */ new Date()).toISOString(), s;
			try {
				let t = await f.stat(e);
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
async function Ge(e, t = 12) {
	let n = 0, r = 0, i = 0, a = [e], o = [], s = async () => {
		for (; a.length > 0;) {
			let t = a.shift();
			if (!t) break;
			let o;
			try {
				o = await f.readdir(t, { withFileTypes: !0 });
			} catch {
				continue;
			}
			t !== e && i++;
			for (let e of o) {
				if (e.name.startsWith("._")) continue;
				let i = d.join(t, e.name);
				if (e.isDirectory()) a.push(i);
				else if (e.isFile()) try {
					let e = await f.stat(i);
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
i.handle("get-folder-size", async (e, t) => {
	try {
		return v(t) ? await Ee(t) : await Ge(t);
	} catch (e) {
		return console.error("get-folder-size failed", t, e), {
			size: 0,
			fileCount: 0,
			dirCount: 0
		};
	}
});
async function Ke(e, t = 50, n = 5e4) {
	let r = [], i = [e], a = 0;
	for (; i.length > 0 && a < n;) {
		let e = i.shift();
		if (!e) break;
		let n;
		try {
			n = await f.readdir(e, { withFileTypes: !0 });
		} catch {
			continue;
		}
		for (let o of n) {
			if (o.name.startsWith("._") || o.name === "$RECYCLE.BIN" || o.name === "System Volume Information") continue;
			let n = d.join(e, o.name);
			if (o.isDirectory()) i.push(n);
			else if (o.isFile()) {
				a++;
				try {
					let e = await f.stat(n), i = d.extname(o.name), a = {
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
i.handle("find-largest-files", async (e, { dirPath: t, limit: n }) => {
	try {
		return await Ke(t, n || 50);
	} catch (e) {
		return console.error("find-largest-files failed", t, e), [];
	}
});
function G(e) {
	let t = (e || "").trim();
	return t = t.replace(/^["']|["']$/g, ""), /^[A-Za-z]:$/.test(t) && (t += "\\"), t;
}
function K(e, t) {
	let n = d.resolve(e), r = d.resolve(t);
	return process.platform === "linux" ? n === r : n.toLowerCase() === r.toLowerCase();
}
function q(e, t) {
	let n = e?.code, r = d.basename(t);
	return n === "EBUSY" ? `"${r}" is locked or currently open in another program.` : n === "EPERM" || n === "EACCES" ? `Permission denied for "${r}". You may need administrator rights, or the file/folder is write-protected.` : n === "ENOENT" ? `"${r}" could not be found or the destination folder does not exist.` : n === "ENOSPC" ? `Not enough free disk space on the target drive to copy "${r}".` : n === "EINVAL" ? `The file name or path "${r}" contains characters not supported by the file system.` : e?.message?.includes("robocopy failed") ? `Folder copy failed for "${r}" (${e.message}).` : e?.message || `Failed to process "${r}".`;
}
async function J(e, t, n) {
	let r = d.parse(t), i = r.name || t, a = r.ext || "", o = d.join(e, t);
	try {
		await f.access(o);
	} catch {
		return o;
	}
	let s = 1;
	for (; s < 9999;) {
		let t = n && s === 1 ? `${i} - Copy${a}` : `${i} (${s})${a}`, r = d.join(e, t);
		try {
			await f.access(r), s++;
		} catch {
			return r;
		}
	}
	return d.join(e, `${i}_${Date.now()}${a}`);
}
async function qe(e, t) {
	let n = d.dirname(t);
	await f.mkdir(n, { recursive: !0 });
	try {
		await f.chmod(t, 438);
	} catch {}
	let r = null;
	for (let n = 0; n < 3; n++) try {
		await f.copyFile(e, t), r = null;
		break;
	} catch (e) {
		if (r = e, e.code === "EPERM" || e.code === "EACCES") try {
			await f.chmod(t, 438);
		} catch {}
		n < 2 && await new Promise((e) => setTimeout(e, 120 * (n + 1)));
	}
	if (r) try {
		await new Promise((n, r) => {
			let i = p.createReadStream(e), a = p.createWriteStream(t, { flags: "w" });
			i.on("error", r), a.on("error", r), a.on("finish", n), i.pipe(a);
		}), r = null;
	} catch (e) {
		throw r || e;
	}
	try {
		let n = await f.stat(e);
		await f.utimes(t, n.atime, n.mtime);
	} catch {}
}
async function Je(e, t) {
	let n = process.platform === "win32" ? /[\\/]+$/ : /\/+$/, r = e.replace(n, "") || e, i = t.replace(n, "") || t;
	if (process.platform === "win32") {
		let e = !1, t = null;
		try {
			await new Promise((e, t) => {
				let n = re("robocopy", [
					r,
					i,
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
				n.stdout?.on("data", (e) => {
					let t = e.toString().trim();
					t && U && U.webContents.send("copy-progress", { line: t.substring(0, 120) });
				}), n.stderr?.on("data", (e) => {
					let t = e.toString().trim();
					t && U && U.webContents.send("copy-progress", { line: "ERR: " + t.substring(0, 110) });
				}), n.on("close", (n) => {
					n >= 8 ? t(/* @__PURE__ */ Error(`robocopy failed with exit code ${n}`)) : e();
				}), n.on("error", (e) => {
					t(e);
				});
			});
		} catch (n) {
			e = !0, t = n;
		}
		if (!e) return;
		console.warn("robocopy failed, falling back to fs.cp:", t?.message);
	}
	await f.cp(e, t, {
		recursive: !0,
		force: !0,
		preserveTimestamps: !0
	});
}
async function Ye(e, t) {
	(await f.stat(e)).isDirectory() ? (await Je(e, t), U && U.webContents.send("copy-progress", { line: `Copied folder: ${d.basename(t)}` })) : (await qe(e, t), U && U.webContents.send("copy-progress", { line: `Copied file: ${d.basename(t)}` }));
}
async function Y(e) {
	try {
		await f.rm(e, {
			recursive: !0,
			force: !0
		});
	} catch (t) {
		try {
			await f.chmod(e, 438), await f.rm(e, {
				recursive: !0,
				force: !0
			});
		} catch {
			throw t;
		}
	}
}
async function Xe(e) {
	let t = "New folder", n = t, r = d.join(e, n), i = 1;
	for (;;) try {
		await f.access(r), n = `${t} (${i})`, r = d.join(e, n), i++;
	} catch {
		break;
	}
	return await f.mkdir(r), r;
}
async function Ze(e) {
	if (process.platform !== "win32") throw Error("Administrator elevation is only supported on Windows.");
	let t = G(e.target), n = !!e.isMove, r = e.action === "createFolder", i = e.action === "delete", a = e.action === "rename", o = [];
	if (r) {
		let n = e.newFolderName || "New folder", r = d.join(t, n), i = 1;
		for (;;) try {
			await f.access(r), r = d.join(t, `${n} (${i})`), i++;
		} catch {
			break;
		}
		o.push({
			dest: r,
			action: "createFolder",
			isDirectory: !0
		});
	} else if (i && e.sources && e.sources.length > 0) for (let t of e.sources) o.push({
		src: t,
		dest: t,
		action: "delete"
	});
	else if (a && e.sources && e.sources.length > 0 && e.newName) {
		let t = e.sources[0];
		o.push({
			src: t,
			dest: d.join(d.dirname(t), e.newName),
			action: "rename",
			newName: e.newName
		});
	} else if (e.sources && e.sources.length > 0) for (let r of e.sources) {
		let i = e.customDestFileName && e.sources.length === 1 ? e.customDestFileName : d.basename(r), a = !1;
		try {
			a = (await f.stat(r)).isDirectory();
		} catch {}
		let s = K(d.dirname(d.resolve(r)), t), c = e.customDestFileName && e.sources.length === 1 ? d.join(t, e.customDestFileName) : await J(t, i, s && !n);
		o.push({
			src: r,
			dest: c,
			action: n ? "move" : "copy",
			isDirectory: a
		});
	}
	if (o.length === 0) return {
		success: !0,
		items: []
	};
	let s = `jabro_elevated_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`, c = d.join(g.tmpdir(), `${s}_config.json`), l = d.join(g.tmpdir(), `${s}_worker.ps1`), u = d.join(g.tmpdir(), `${s}_result.json`), m = {
		isMove: n,
		targetDir: t,
		items: o,
		resultFile: u
	};
	await f.writeFile(c, JSON.stringify(m, null, 2), "utf8"), await f.writeFile(l, "\nparam([string]$ConfigPath)\n\n$result = @{\n    success = $false\n    items = @()\n    error = $null\n}\n\ntry {\n    $raw = [System.IO.File]::ReadAllText($ConfigPath, [System.Text.Encoding]::UTF8)\n    $cfg = $raw | ConvertFrom-Json\n    $resPath = [string]$cfg.resultFile\n\n    if (-not (Test-Path -LiteralPath $cfg.targetDir)) {\n        New-Item -ItemType Directory -LiteralPath $cfg.targetDir -Force | Out-Null\n    }\n\n    foreach ($item in $cfg.items) {\n        $src = [string]$item.src\n        $dest = [string]$item.dest\n        $act = [string]$item.action\n        $isDir = [bool]$item.isDirectory\n        $newName = [string]$item.newName\n\n        try {\n            if ($act -eq 'createFolder') {\n                New-Item -ItemType Directory -LiteralPath $dest -Force | Out-Null\n            } elseif ($act -eq 'delete') {\n                Remove-Item -LiteralPath $src -Recurse -Force -ErrorAction Stop\n            } elseif ($act -eq 'rename') {\n                Rename-Item -LiteralPath $src -NewName $newName -Force -ErrorAction Stop\n            } elseif ($act -eq 'move') {\n                if (Test-Path -LiteralPath $dest) {\n                    Remove-Item -LiteralPath $dest -Recurse -Force -ErrorAction SilentlyContinue\n                }\n                Move-Item -LiteralPath $src -Destination $dest -Force -ErrorAction Stop\n            } else {\n                if ($isDir) {\n                    if (-not (Test-Path -LiteralPath $dest)) {\n                        New-Item -ItemType Directory -LiteralPath $dest -Force | Out-Null\n                    }\n                    $cleanSrc = $src.TrimEnd('\\', '/')\n                    $cleanDest = $dest.TrimEnd('\\', '/')\n                    $rcArgs = @($cleanSrc, $cleanDest, '/E', '/COPY:DAT', '/R:1', '/W:1', '/IS', '/NFL', '/NDL', '/NP')\n                    $rcProc = Start-Process -FilePath \"robocopy.exe\" -ArgumentList $rcArgs -Wait -NoNewWindow -PassThru\n                    if ($rcProc.ExitCode -ge 8) {\n                        Copy-Item -LiteralPath $src -Destination $dest -Recurse -Force -ErrorAction Stop\n                    }\n                } else {\n                    Copy-Item -LiteralPath $src -Destination $dest -Force -ErrorAction Stop\n                }\n            }\n\n            $result.items += @{\n                src = $src\n                dest = $dest\n                name = [System.IO.Path]::GetFileName($dest)\n                success = $true\n            }\n        } catch {\n            $result.items += @{\n                src = $src\n                dest = $dest\n                name = [System.IO.Path]::GetFileName($src)\n                success = $false\n                error = $_.Exception.Message\n            }\n        }\n    }\n\n    $failed = ($result.items | Where-Object { -not $_.success }).Count\n    if ($failed -eq 0) {\n        $result.success = $true\n    } else {\n        $result.success = $false\n        $result.error = \"Some items failed to copy with administrator rights.\"\n    }\n} catch {\n    $result.success = $false\n    $result.error = $_.Exception.Message\n} finally {\n    if ($resPath) {\n        $out = $result | ConvertTo-Json -Depth 5\n        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)\n        [System.IO.File]::WriteAllText($resPath, $out, $utf8NoBom)\n    }\n}\n", "utf8");
	let h = `
try {
  $p = Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -PassThru -ArgumentList @(
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', '${l.replace(/'/g, "''")}',
      '${c.replace(/'/g, "''")}'
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
		let s = re("powershell.exe", [
			"-NoProfile",
			"-Command",
			h
		], { windowsHide: !0 }), m = "";
		s.stderr?.on("data", (e) => {
			m += e.toString();
		}), s.on("close", async (t) => {
			try {
				if (t === 1223 || m.includes("UAC_CANCELLED") || m.includes("canceled by the user")) {
					e({
						success: !1,
						cancelled: !0,
						summary: "Operation cancelled by user."
					});
					return;
				}
				let s = null;
				try {
					if (p.existsSync(u)) {
						let e = await f.readFile(u, "utf8");
						s = JSON.parse(e.replace(/^\uFEFF/, ""));
					}
				} catch (e) {
					console.error("Failed to read elevated result file:", e);
				}
				s && s.success ? e({
					success: !0,
					items: s.items,
					summary: r ? `Created folder "${d.basename(o[0]?.dest)}"` : i ? `Deleted ${s.items?.length || 1} item(s) with administrator privileges.` : a ? "Renamed item with administrator privileges." : `Successfully ${n ? "moved" : "copied"} ${s.items?.length || 1} items with administrator privileges.`
				}) : e({
					success: !1,
					error: s?.error || `Elevation process exited with code ${t}`,
					items: s?.items || []
				});
			} finally {
				try {
					await f.unlink(c);
				} catch {}
				try {
					await f.unlink(l);
				} catch {}
				try {
					await f.unlink(u);
				} catch {}
			}
		}), s.on("error", (e) => {
			t(e);
		});
	});
}
function X(e, t) {
	i.handle(e, async (e, ...n) => {
		let r = await t(e, ...n);
		if (process.platform !== "win32" && r && r.requiresElevation) {
			let { requiresElevation: e, ...t } = r, n = t.summary || t.error || "Permission denied.";
			return {
				...t,
				success: !1,
				error: t.error || n
			};
		}
		return r;
	});
}
i.handle("perform-elevated-op", async (e, t) => Ze(t));
var Z = (e) => {
	U && !U.isDestroyed() && U.webContents.send("copy-progress", e);
};
X("copy-files", async (e, { sources: t, target: n }) => {
	let r = v(n), i = t.filter((e) => v(e)), a = t.filter((e) => !v(e));
	if (r || i.length > 0) {
		if (r && a.length > 0 && i.length === 0) return R(a, n, !1, Y, Z);
		if (!r && i.length > 0 && a.length === 0) return z(i, G(n), !1, J, Z);
		if (r && i.length > 0 && a.length === 0) return B(i, n, !1, Z);
		let e = [], t = [];
		if (a.length > 0) {
			let i = r ? await R(a, n, !1, Y, Z) : null;
			i && (e.push(...i.items || []), t.push(...i.errors || []));
		}
		if (i.length > 0) {
			let a = r ? await B(i, n, !1, Z) : await z(i, G(n), !1, J, Z);
			e.push(...a.items || []), t.push(...a.errors || []);
		}
		return {
			success: t.length === 0,
			type: "copy",
			target: n,
			items: e,
			summary: t.length === 0 ? `Copied ${e.length} items` : t[0],
			errors: t
		};
	}
	let o = G(n);
	try {
		(await f.stat(o)).isDirectory() || (o = d.dirname(o));
	} catch {}
	try {
		await f.mkdir(o, { recursive: !0 });
	} catch (e) {
		if (e.code === "EPERM" || e.code === "EACCES") return {
			success: !1,
			requiresElevation: !0,
			type: "copy",
			target: o,
			sources: t,
			summary: `Administrator permission is required to copy to "${o}".`,
			errors: [`Permission denied creating or accessing "${o}".`]
		};
	}
	let s = [], c = [];
	for (let e = 0; e < t.length; e++) {
		let n = t[e], r = d.basename(n);
		U && U.webContents.send("copy-progress", {
			line: `Copying ${r} (${e + 1}/${t.length})...`,
			current: e + 1,
			total: t.length,
			fileName: r,
			phase: "copying"
		});
		try {
			try {
				await f.access(n);
			} catch {
				throw Error(`Source "${r}" does not exist or cannot be accessed.`);
			}
			let e = K(d.dirname(d.resolve(n)), o), t = await J(o, r, e);
			await Ye(n, t), s.push({
				src: n,
				dest: t,
				name: d.basename(t),
				success: !0
			});
		} catch (e) {
			let t = q(e, n);
			c.push(t), s.push({
				src: n,
				name: r,
				success: !1,
				error: t
			}), console.error(`Error copying ${n} to ${o}:`, e);
		}
	}
	let l = s.filter((e) => e.success).length, u = s.filter((e) => !e.success).length, p = "";
	if (u === 0) p = l === 1 ? `Successfully copied "${s[0]?.name}"` : `Successfully copied ${l} items`, U && U.webContents.send("copy-progress", {
		line: p,
		phase: "complete",
		success: !0
	});
	else if (l === 0) {
		if (p = `Failed to copy ${t.length === 1 ? `"${d.basename(t[0])}"` : `${t.length} items`}: ${c[0]}`, U && U.webContents.send("copy-progress", {
			line: p,
			phase: "failed",
			success: !1,
			errors: c
		}), c.some((e) => e.includes("Permission denied") || e.includes("administrator"))) return {
			success: !1,
			requiresElevation: !0,
			type: "copy",
			target: o,
			sources: t,
			summary: `Administrator permission is required to copy to "${o}".`,
			errors: c
		};
		throw Error(p);
	} else p = `Copied ${l} of ${t.length} items (${u} failed).`, U && U.webContents.send("copy-progress", {
		line: p,
		phase: "partial",
		success: !1,
		errors: c
	});
	return {
		success: u === 0,
		type: "copy",
		target: o,
		items: s,
		summary: p,
		errors: c
	};
}), X("move-files", async (e, { sources: t, target: n }) => {
	let r = v(n), i = t.filter((e) => v(e)), a = t.filter((e) => !v(e));
	if (r || i.length > 0) {
		if (r && a.length > 0 && i.length === 0) return R(a, n, !0, Y, Z);
		if (!r && i.length > 0 && a.length === 0) return z(i, G(n), !0, J, Z);
		if (r && i.length > 0 && a.length === 0) return B(i, n, !0, Z);
		let e = [], t = [];
		if (a.length > 0 && r) {
			let r = await R(a, n, !0, Y, Z);
			e.push(...r.items || []), t.push(...r.errors || []);
		}
		if (i.length > 0) {
			let a = r ? await B(i, n, !0, Z) : await z(i, G(n), !0, J, Z);
			e.push(...a.items || []), t.push(...a.errors || []);
		}
		return {
			success: t.length === 0,
			type: "move",
			target: n,
			items: e,
			summary: t.length === 0 ? `Moved ${e.length} items` : t[0],
			errors: t
		};
	}
	let o = G(n);
	try {
		(await f.stat(o)).isDirectory() || (o = d.dirname(o));
	} catch {}
	try {
		await f.mkdir(o, { recursive: !0 });
	} catch (e) {
		if (e.code === "EPERM" || e.code === "EACCES") return {
			success: !1,
			requiresElevation: !0,
			type: "move",
			target: o,
			sources: t,
			summary: `Administrator permission is required to move to "${o}".`,
			errors: [`Permission denied creating or accessing "${o}".`]
		};
	}
	let s = [], c = [];
	for (let e = 0; e < t.length; e++) {
		let n = t[e], r = d.basename(n);
		U && U.webContents.send("copy-progress", {
			line: `Moving ${r} (${e + 1}/${t.length})...`,
			current: e + 1,
			total: t.length,
			fileName: r,
			phase: "moving"
		});
		try {
			try {
				await f.access(n);
			} catch {
				throw Error(`Source "${r}" does not exist or cannot be accessed.`);
			}
			if (K(d.dirname(d.resolve(n)), o)) {
				s.push({
					src: n,
					dest: n,
					name: r,
					success: !0
				});
				continue;
			}
			let e = await J(o, r, !1), t = !1;
			try {
				await f.rename(n, e), t = !0;
			} catch (r) {
				if (r.code === "EXDEV" || r.code === "EPERM" || r.code === "EBUSY") await Ye(n, e), await Y(n), t = !0;
				else throw r;
			}
			t && s.push({
				src: n,
				dest: e,
				name: d.basename(e),
				success: !0
			});
		} catch (e) {
			let t = q(e, n);
			c.push(t), s.push({
				src: n,
				name: r,
				success: !1,
				error: t
			}), console.error(`Error moving ${n} to ${o}:`, e);
		}
	}
	let l = s.filter((e) => e.success).length, u = s.filter((e) => !e.success).length, p = "";
	if (u === 0) p = l === 1 ? `Successfully moved "${s[0]?.name}"` : `Successfully moved ${l} items`, U && U.webContents.send("copy-progress", {
		line: p,
		phase: "complete",
		success: !0
	});
	else if (l === 0) {
		if (p = `Failed to move ${t.length === 1 ? `"${d.basename(t[0])}"` : `${t.length} items`}: ${c[0]}`, U && U.webContents.send("copy-progress", {
			line: p,
			phase: "failed",
			success: !1,
			errors: c
		}), c.some((e) => e.includes("Permission denied") || e.includes("administrator"))) return {
			success: !1,
			requiresElevation: !0,
			type: "move",
			target: o,
			sources: t,
			summary: `Administrator permission is required to move to "${o}".`,
			errors: c
		};
		throw Error(p);
	} else p = `Moved ${l} of ${t.length} items (${u} failed).`, U && U.webContents.send("copy-progress", {
		line: p,
		phase: "partial",
		success: !1,
		errors: c
	});
	return {
		success: u === 0,
		type: "move",
		target: o,
		items: s,
		summary: p,
		errors: c
	};
}), X("create-folder", async (e, t) => {
	if (v(t)) return De(t);
	try {
		return await Xe(t);
	} catch (e) {
		if (console.error("create-folder failed for", t, e), e.code === "EPERM" || e.code === "EACCES") return {
			success: !1,
			requiresElevation: !0,
			target: t,
			error: "Administrator permission required to create folder here."
		};
		throw e;
	}
}), X("delete-items", async (e, { paths: t, permanent: n }) => {
	if (!Array.isArray(t) || t.length === 0) return {
		success: !1,
		items: [],
		summary: "No items selected.",
		errors: ["No items selected."]
	};
	let r = t.filter((e) => v(e)), i = t.filter((e) => !v(e)), a = [], o = [];
	if (r.length > 0) {
		let e = await ke(r);
		a.push(...e.items), o.push(...e.errors);
	}
	for (let e of i) {
		let t = d.basename(e) || e;
		try {
			await f.access(e), n ? await Y(e) : await u.trashItem(e), a.push({
				path: e,
				name: t,
				success: !0
			});
		} catch (n) {
			let r = q(n, e);
			o.push(r), a.push({
				path: e,
				name: t,
				success: !1,
				error: r
			});
		}
	}
	let s = a.filter((e) => e.success).length, c = a.length - s;
	if (s === 0 && i.length > 0 && r.length === 0 && o.some((e) => e.includes("Permission denied") || e.includes("administrator"))) return {
		success: !1,
		requiresElevation: !0,
		action: "delete",
		sources: i,
		target: d.dirname(i[0]),
		summary: `Administrator permission is required to delete "${d.basename(i[0])}".`,
		errors: o
	};
	let l = r.length > 0 && i.length === 0 ? "Deleted" : n ? "Permanently deleted" : "Moved to Trash", p = c === 0 ? s === 1 ? `${l}: "${a[0].name}"` : `${l}: ${s} items` : `${l} ${s} of ${a.length} items (${c} failed).`;
	return {
		success: c === 0,
		items: a,
		summary: p,
		errors: o
	};
}), X("rename-item", async (e, { targetPath: t, newName: n }) => {
	if (!t || !n) return {
		success: !1,
		error: "Target path and new name are required."
	};
	if (v(t)) return Oe(t, n);
	let r = n.trim().replace(/[\\/]/g, "");
	if (!r || r === "." || r === "..") return {
		success: !1,
		error: "Invalid file or folder name."
	};
	let i = d.dirname(t), a = d.join(i, r);
	if (K(t, a)) return {
		success: !0,
		oldPath: t,
		newPath: a
	};
	try {
		try {
			return await f.access(a), {
				success: !1,
				error: `An item named "${r}" already exists.`
			};
		} catch {}
		return await f.rename(t, a), {
			success: !0,
			oldPath: t,
			newPath: a
		};
	} catch (e) {
		return e.code === "EPERM" || e.code === "EACCES" ? {
			success: !1,
			requiresElevation: !0,
			action: "rename",
			sources: [t],
			target: i,
			newName: r,
			error: "Administrator permission required to rename this item."
		} : {
			success: !1,
			error: q(e, t)
		};
	}
}), i.handle("remote:list-connections", async () => he()), i.handle("remote:save-connection", async (e, t) => ge(t)), i.handle("remote:delete-connection", async (e, t) => _e(t)), i.handle("remote:test-connection", async (e, t) => ve(t)), i.handle("remote:connect", async (e, t) => Se(t)), i.handle("remote:disconnect", async (e, t) => M(t)), i.handle("remote:select-key-file", async () => {
	if (!U) return null;
	let e = d.join(g.homedir(), ".ssh"), t = await r.showOpenDialog(U, {
		title: "Select SSH Private Key File",
		defaultPath: p.existsSync(e) ? e : g.homedir(),
		properties: ["openFile", "showHiddenFiles"]
	});
	return t.canceled || t.filePaths.length === 0 ? null : t.filePaths[0];
}), i.handle("select-folder", async () => {
	if (!U) return null;
	let e = await r.showOpenDialog(U, {
		properties: ["openDirectory", "createDirectory"],
		title: "Open folder"
	});
	return e.canceled || e.filePaths.length === 0 ? null : e.filePaths[0];
}), i.handle("select-files", async () => {
	if (!U) return [];
	let e = await r.showOpenDialog(U, {
		properties: ["openFile", "multiSelections"],
		title: "Select files to add to collection"
	});
	return e.canceled || e.filePaths.length === 0 ? [] : e.filePaths;
}), i.handle("get-entries-stats", async (e, t) => {
	if (!Array.isArray(t)) return [];
	let n = [];
	for (let e of t) if (!(!e || typeof e != "string")) try {
		let t = await f.stat(e), r = t.isDirectory(), i = d.basename(e) || e, a = r ? void 0 : d.extname(i).toLowerCase() || void 0;
		n.push({
			name: i,
			path: e,
			isDirectory: r,
			mtime: t.mtime.toISOString(),
			size: r ? void 0 : t.size,
			ext: a
		});
	} catch {
		let t = d.basename(e) || e, r = d.extname(t).toLowerCase() || void 0;
		n.push({
			name: t,
			path: e,
			isDirectory: !1,
			mtime: (/* @__PURE__ */ new Date()).toISOString(),
			size: 0,
			ext: r,
			missing: !0
		});
	}
	return n;
}), X("save-file-as", async (e, t) => {
	if (!U) return { canceled: !0 };
	let i = v(t);
	if (!i) try {
		if ((await f.stat(t)).isDirectory()) return {
			success: !1,
			error: "Cannot \"Save as\" a directory. Please select a file."
		};
	} catch (e) {
		return {
			success: !1,
			error: `Source file does not exist or cannot be accessed: ${e?.message || e}`
		};
	}
	let a = i ? b(t) : null, o = a ? d.posix.basename(a.remotePath) : d.basename(t), s = d.extname(o).replace(/^\./, ""), c = [];
	s && c.push({
		name: `${s.toUpperCase()} File (*.${s})`,
		extensions: [s]
	}), c.push({
		name: "All Files (*.*)",
		extensions: ["*"]
	});
	let l = await r.showSaveDialog(U, {
		title: "Save As",
		defaultPath: i ? d.join(n.getPath("downloads"), o) : t,
		filters: c,
		properties: ["showOverwriteConfirmation", "createDirectory"]
	});
	if (l.canceled || !l.filePath) return { canceled: !0 };
	let u = l.filePath;
	if (!i && K(t, u)) return {
		success: !1,
		error: "Destination is identical to the source file."
	};
	try {
		return await f.mkdir(d.dirname(u), { recursive: !0 }), i ? await Me(t, u, Z) : await qe(t, u), {
			success: !0,
			sourcePath: t,
			destPath: u,
			destDir: d.dirname(u),
			destFileName: d.basename(u)
		};
	} catch (e) {
		let n = e?.message || String(e);
		return n.includes("EPERM") || n.includes("EACCES") || n.includes("Permission denied") ? {
			success: !1,
			requiresElevation: !0,
			sourcePath: t,
			destPath: u,
			destDir: d.dirname(u),
			destFileName: d.basename(u),
			error: n
		} : {
			success: !1,
			error: n
		};
	}
}), i.handle("open-path", async (e, t) => {
	if (v(t)) {
		let e = await P(t);
		await u.openPath(e);
		return;
	}
	await u.openPath(t);
}), i.handle("show-in-explorer", async (e, t) => {
	v(t) || u.showItemInFolder(t);
}), i.handle("read-text-file", async (e, t) => {
	try {
		return v(t) ? await je(t, 1024 * 1024) : (await f.stat(t)).size > 1024 * 1024 ? "[File too large to preview as text. Use \"Open with default app\".]" : await f.readFile(t, "utf8");
	} catch {
		return "[Unable to read file as text.]";
	}
}), i.handle("read-binary-file", async (e, t) => {
	try {
		return await f.readFile(t);
	} catch (e) {
		return console.error("read-binary-file failed:", e), null;
	}
}), i.handle("open-terminal", async (e, t, n = "cmd") => {
	try {
		if (process.platform === "win32") {
			let e = t.replace(/"/g, "\\\"");
			await Fe(n === "powershell" ? `start powershell -NoExit -Command "Set-Location -LiteralPath '${e}'"` : `start cmd /K "cd /D \\"${e}\\""`, { cwd: t });
		} else if (process.platform === "darwin") await Ie("open", [
			"-a",
			"Terminal",
			t
		]);
		else {
			let e = [
				["x-terminal-emulator", []],
				["gnome-terminal", ["--working-directory", t]],
				["konsole", ["--workdir", t]],
				["xfce4-terminal", ["--working-directory", t]],
				["xterm", []]
			];
			for (let [n, r] of e) if (await new Promise((e) => {
				let i = re(n, r, {
					cwd: t,
					detached: !0,
					stdio: "ignore"
				});
				i.once("error", () => e(!1)), i.once("spawn", () => {
					i.unref(), e(!0);
				});
			})) break;
		}
	} catch (e) {
		console.error("Failed to open terminal", e);
	}
});
async function Qe() {
	let e = process.platform === "darwin" ? ["/Volumes"] : (() => {
		let e = g.userInfo().username;
		return [
			`/media/${e}`,
			`/run/media/${e}`,
			"/media",
			"/mnt"
		];
	})(), t = process.platform === "darwin" ? "Macintosh HD" : void 0, n = [], r = new Set(["/"]);
	for (let i of e) {
		let e = [];
		try {
			e = await f.readdir(i);
		} catch {
			continue;
		}
		for (let a of e) {
			if (a.startsWith(".")) continue;
			let e = d.join(i, a);
			try {
				let i = await f.realpath(e);
				if (i === "/") {
					process.platform === "darwin" && (t = a);
					continue;
				}
				if (!(await f.stat(e)).isDirectory() || r.has(i)) continue;
				r.add(i), n.push({
					name: a,
					path: e
				});
			} catch {}
		}
	}
	let i = [{
		name: "/",
		path: "/",
		label: t
	}, ...n];
	return await Promise.all(i.map(async (e) => {
		try {
			let t = await f.statfs(e.path);
			e.size = Number(t.blocks) * Number(t.bsize), e.freeSpace = Number(t.bavail) * Number(t.bsize);
		} catch {}
	})), i;
}
i.handle("get-drives", async () => {
	if (process.platform !== "win32") return Qe();
	try {
		let { stdout: e } = await Fe("powershell -NoProfile -Command \"@(Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID, VolumeName, Description, Size, FreeSpace) | ConvertTo-Json\""), t = JSON.parse(e || "[]"), n = (Array.isArray(t) ? t : [t]).filter((e) => e?.DeviceID && /^[A-Za-z]:/i.test(e.DeviceID)).map((e) => {
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
		await f.access(n);
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
}), i.handle("get-default-quick-access", async () => {
	try {
		return [
			{
				label: "Desktop",
				path: n.getPath("desktop")
			},
			{
				label: "Documents",
				path: n.getPath("documents")
			},
			{
				label: "Downloads",
				path: n.getPath("downloads")
			}
		];
	} catch (e) {
		return console.error("get-default-quick-access failed", e), [];
	}
});
var Q = d.join(n.getPath("userData"), "thumbnails_cache");
try {
	p.mkdirSync(Q, { recursive: !0 });
} catch (e) {
	console.error("Failed to initialize thumbnail cache dir:", e);
}
var $e = new Set(/* @__PURE__ */ ".png,.jpg,.jpeg,.webp,.bmp,.gif,.ico,.svg,.tif,.tiff,.jfif,.avif,.mp4,.mov,.mkv,.avi,.wmv,.webm,.m4v,.flv,.pdf,.glb,.gltf,.obj,.stl,.ply,.fbx,.splat,.ksplat,.spz".split(",")), et = new Set([
	".glb",
	".gltf",
	".obj",
	".stl",
	".ply",
	".fbx",
	".splat",
	".ksplat",
	".spz"
]);
function tt(e, t, n) {
	let r = d.normalize(e).toLowerCase(), i = et.has(d.extname(r)) ? ":r1" : "";
	return ee.createHash("sha256").update(`${r}:${t}:${n || 0}:256${i}`).digest("hex");
}
function $(e) {
	return `jabro-media://localhost?path=${encodeURIComponent(e)}`;
}
var nt = new class {
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
async function rt(e, t, n) {
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
		await f.mkdir(d.dirname(t), { recursive: !0 });
	} catch {}
	if (r) try {
		let n = a.createFromPath(e);
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
				return await f.writeFile(t, a), !0;
			}
		}
	} catch {}
	try {
		if (typeof a.createThumbnailFromPath == "function") {
			let n = await a.createThumbnailFromPath(e, {
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
				return await f.writeFile(t, i), !0;
			}
		}
	} catch {}
	return !1;
}
i.handle("get-thumbnail", async (e, { filePath: t, mtime: n, size: r }) => {
	if (!t || v(t)) return { hasPreview: !1 };
	let i = d.extname(t).toLowerCase();
	if (!$e.has(i)) return { hasPreview: !1 };
	let a = n, o = r;
	if (!a || o === void 0 || o === 0) try {
		let e = await f.stat(t);
		a = e.mtime.toISOString(), o = e.size;
	} catch {}
	let s = tt(t, a, o), c = d.join(Q, `${s}.jpg`);
	return p.existsSync(c) ? {
		url: $(c),
		hasPreview: !0
	} : et.has(i) ? { hasPreview: !1 } : nt.enqueue(s, async () => p.existsSync(c) || await rt(t, c, i) ? {
		url: $(c),
		hasPreview: !0
	} : { hasPreview: !1 });
}), i.handle("get-thumbnails-batch", async (e, t) => {
	let n = {};
	if (!Array.isArray(t)) return n;
	for (let e of t) {
		if (!e?.filePath) continue;
		let t = d.extname(e.filePath).toLowerCase();
		if (!$e.has(t)) continue;
		let r = tt(e.filePath, e.mtime, e.size), i = d.join(Q, `${r}.jpg`);
		p.existsSync(i) && (n[e.filePath] = $(i));
	}
	return n;
}), i.handle("read-file-snippet", async (e, t, n = 240) => {
	if (!t || v(t)) return "";
	try {
		let e = await f.open(t, "r"), r = Buffer.alloc(1024), { bytesRead: i } = await e.read(r, 0, 1024, 0);
		return await e.close(), r.toString("utf8", 0, i).slice(0, n);
	} catch {
		return "";
	}
}), i.handle("get-thumbnail-cache-stats", async () => {
	try {
		let e = await f.readdir(Q), t = 0, n = 0;
		for (let r of e) if (r.endsWith(".jpg") || r.endsWith(".webp")) {
			n++;
			try {
				let e = await f.stat(d.join(Q, r));
				t += e.size;
			} catch {}
		}
		return {
			count: n,
			sizeBytes: t,
			cachePath: Q
		};
	} catch {
		return {
			count: 0,
			sizeBytes: 0,
			cachePath: Q
		};
	}
}), i.handle("clear-thumbnail-cache", async () => {
	try {
		let e = await f.readdir(Q), t = 0, n = 0;
		for (let r of e) if (r.endsWith(".jpg") || r.endsWith(".webp")) {
			let e = d.join(Q, r);
			try {
				let r = await f.stat(e);
				t += r.size, await f.unlink(e), n++;
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
}), i.handle("open-thumbnail-cache-folder", async () => {
	try {
		await u.openPath(Q);
	} catch (e) {
		console.error("Failed to open thumbnail cache folder:", e);
	}
}), i.handle("save-thumbnail-cache", async (e, { filePath: t, dataUrl: n, mtime: r, size: i }) => {
	try {
		if (!t || !n) return !1;
		let e = n.replace(/^data:image\/\w+;base64,/, ""), o = Buffer.from(e, "base64"), s = r, c = i;
		if (!s || c == null) try {
			let e = await f.stat(t);
			s = e.mtime.toISOString(), c = e.size;
		} catch {
			s = (/* @__PURE__ */ new Date()).toISOString(), c = 0;
		}
		let l = tt(t, s, c), u = d.join(Q, `${l}.jpg`);
		await f.mkdir(d.dirname(u), { recursive: !0 });
		let p = a.createFromBuffer(o);
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
		return await f.writeFile(u, g), !0;
	} catch (e) {
		return console.error("save-thumbnail-cache failed:", e), !1;
	}
});
//#endregion
