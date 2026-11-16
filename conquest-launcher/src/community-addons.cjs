// CoA Custom Races addition to Conquest Launcher (originally developed by Duff (Duff-SPP)); GPL-3.0-only.
// Community addons: entries come from ONE data file (community-addons.json), are downloaded from GitHub, checked, extracted to a
// scratch folder and only then copied into the client. The launcher records every file it installs and only ever removes those.
// Nothing executable is installed: only files with a plain addon extension are copied (no .exe, .bat, .cmd, .vbs, .ps1, .dll ...).
const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { safePath, filePath, hashFile, atomicJson, statOrNull } = require('./release-format.cjs');

const RECORD = '.coa-launcher/community-addons.json';
const CHECK_TTL = 6 * 3600 * 1000; // one GitHub look per addon every 6 hours
const ALLOWED_EXTENSIONS = new Set(['.lua', '.xml', '.toc', '.tga', '.blp', '.ttf', '.otf', '.png', '.jpg', '.jpeg', '.ogg', '.mp3', '.wav', '.txt', '.md', '.textile', '.json']);
const ALLOWED_PLAIN = /^(license|licence|copying|readme|notice|authors|changelog|credits)[\w.-]*$/i; // files with no extension
const LIMITS = { files: 40000, unpacked: 6 * 1024 ** 3 };
const TARGET = /^Interface\/(AddOns\/[A-Za-z0-9_.'-]+\*?|PTRXML)$/;

// ---------- catalog ----------

function text(value, label, max = 700) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Community addons: ${label} is missing or too long.`);
  return value;
}
function validateCatalog(data) {
  if (!data || data.schema !== 1 || !Array.isArray(data.addons) || data.addons.length > 200) throw new Error('Community addons: invalid catalog file.');
  const ids = new Set();
  const addons = data.addons.map(raw => {
    if (!raw || typeof raw !== 'object') throw new Error('Community addons: invalid entry.');
    const id = text(raw.id, 'id', 40);
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(id) || ids.has(id)) throw new Error(`Community addons: bad or duplicate id ${id}.`);
    ids.add(id);
    const source = raw.source;
    if (!source || !['release', 'tarball'].includes(source.type) || !/^[\w.-]+\/[\w.-]+$/.test(source.repo || '')) throw new Error(`Community addons: ${id} has no valid GitHub source.`);
    if (source.type === 'release') {
      if (!Array.isArray(source.assets) || !source.assets.length || source.assets.length > 8) throw new Error(`Community addons: ${id} needs 1 to 8 asset patterns.`);
      for (const asset of source.assets) { try { new RegExp(asset.pattern); } catch { throw new Error(`Community addons: ${id} has an invalid asset pattern.`); } }
    } else if (!/^[0-9a-f]{40}$/.test(source.commit || '')) throw new Error(`Community addons: ${id} needs a pinned 40-character commit.`);
    const archive = raw.archive || {};
    if (!['zip', 'tar.gz'].includes(archive.format) || !['AddOns', 'client'].includes(archive.base)) throw new Error(`Community addons: ${id} has an invalid archive description.`);
    if (!Array.isArray(raw.targets) || !raw.targets.length || raw.targets.some(t => !TARGET.test(t))) throw new Error(`Community addons: ${id} has an invalid install folder.`);
    return {
      id, name: text(raw.name, 'name', 80), description: text(raw.description, 'description'), author: text(raw.author, 'author', 200), license: text(raw.license, 'license'),
      licenseUrl: raw.licenseUrl ? httpsUrl(raw.licenseUrl) : '', homepage: httpsUrl(raw.homepage), notes: typeof raw.notes === 'string' ? raw.notes : '',
      warnings: Array.isArray(raw.warnings) ? raw.warnings.filter(w => typeof w === 'string').slice(0, 6) : [], conflicts: Array.isArray(raw.conflicts) ? raw.conflicts.filter(c => /^[\w.-]+$/.test(c)) : [],
      sizeBytes: Number.isSafeInteger(raw.sizeBytes) ? raw.sizeBytes : 0, unpackedBytes: Number.isSafeInteger(raw.unpackedBytes) ? raw.unpackedBytes : 0,
      source, archive: { format: archive.format, base: archive.base, strip: Number.isInteger(archive.strip) ? archive.strip : 0 }, targets: raw.targets
    };
  });
  return addons;
}
function httpsUrl(value) {
  const url = new URL(text(value, 'link', 300));
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') throw new Error('Community addons: links must be https://github.com/ ones.');
  return url.href;
}
// The default is a literal require so the production bundle inlines the data file.
function loadCatalog(file) { return validateCatalog(file ? JSON.parse(fss.readFileSync(file, 'utf8')) : JSON.parse(JSON.stringify(require('./community-addons.json')))); }

// ---------- zip central directory (checked before anything is extracted) ----------

async function readZipEntries(file) {
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const tail = Buffer.alloc(Math.min(size, 65557)); await handle.read(tail, 0, tail.length, size - tail.length);
    const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0) throw new Error('The download is not a valid zip file.');
    let total = tail.readUInt16LE(eocd + 10); let cdSize = tail.readUInt32LE(eocd + 12); let cdOffset = tail.readUInt32LE(eocd + 16);
    if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      const loc = Buffer.alloc(20); await handle.read(loc, 0, 20, size - tail.length + eocd - 20);
      if (loc.readUInt32LE(0) !== 0x07064b50) throw new Error('The zip file is damaged.');
      const rec = Buffer.alloc(56); await handle.read(rec, 0, 56, Number(loc.readBigUInt64LE(8)));
      if (rec.readUInt32LE(0) !== 0x06064b50) throw new Error('The zip file is damaged.');
      total = Number(rec.readBigUInt64LE(32)); cdSize = Number(rec.readBigUInt64LE(40)); cdOffset = Number(rec.readBigUInt64LE(48));
    }
    if (cdSize > 256 * 1024 ** 2 || total > LIMITS.files * 2) throw new Error('The zip file is unreasonably large.');
    const cd = Buffer.alloc(cdSize); await handle.read(cd, 0, cdSize, cdOffset);
    const entries = []; let at = 0;
    for (let i = 0; i < total; i++) {
      if (at + 46 > cd.length || cd.readUInt32LE(at) !== 0x02014b50) throw new Error('The zip file is damaged.');
      const made = cd.readUInt16LE(at + 4); const flags = cd.readUInt16LE(at + 8); const method = cd.readUInt16LE(at + 10);
      let csize = cd.readUInt32LE(at + 20); let usize = cd.readUInt32LE(at + 24);
      const nameLength = cd.readUInt16LE(at + 28); const extraLength = cd.readUInt16LE(at + 30); const commentLength = cd.readUInt16LE(at + 32);
      const attributes = cd.readUInt32LE(at + 38);
      const name = cd.toString(flags & 0x800 ? 'utf8' : 'latin1', at + 46, at + 46 + nameLength);
      let extra = at + 46 + nameLength; const extraEnd = extra + extraLength;
      while (extra + 4 <= extraEnd) {
        const id = cd.readUInt16LE(extra); const length = cd.readUInt16LE(extra + 2);
        if (id === 1) { let p = extra + 4; if (usize === 0xffffffff) { usize = Number(cd.readBigUInt64LE(p)); p += 8; } if (csize === 0xffffffff) csize = Number(cd.readBigUInt64LE(p)); }
        extra += 4 + length;
      }
      entries.push({ name, size: usize, compressed: csize, encrypted: (flags & 1) !== 0, method, directory: name.endsWith('/'), symlink: (made >> 8) === 3 && ((attributes >>> 16) & 0xf000) === 0xa000 });
      at += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  } finally { await handle.close(); }
}
function checkEntries(entries) {
  if (entries.length > LIMITS.files) throw new Error('The archive has too many files.');
  const seen = new Set(); let total = 0;
  for (const entry of entries) {
    const name = entry.directory ? entry.name.slice(0, -1) : entry.name;
    if (!name) continue;
    filePath(name); // no absolute path, no .., no backslash, no reserved names
    if (entry.encrypted) throw new Error('The archive is password protected.');
    if (entry.symlink) throw new Error(`The archive contains a link (${name}); links are not installed.`);
    const key = name.toLowerCase(); if (seen.has(key)) throw new Error(`The archive lists ${name} twice.`);
    seen.add(key); total += entry.size;
  }
  if (!Number.isSafeInteger(total) || total > LIMITS.unpacked) throw new Error('The archive unpacks to an unreasonable size.');
  return total;
}

// ---------- the service ----------

class CommunityAddons {
  // fetchImpl: the launcher's network function; notify(status): progress; cacheFile: where update checks are remembered.
  constructor({ fetchImpl, notify = () => {}, catalog = loadCatalog(), cacheFile = '', tmpRoot = path.join(os.tmpdir(), 'coa-community-addons'), now = () => Date.now() }) {
    this.fetch = fetchImpl; this.notify = notify; this.catalog = catalog; this.cacheFile = cacheFile; this.tmpRoot = tmpRoot; this.now = now;
    this.cache = null; this.busy = false;
  }

  entry(id) { const found = this.catalog.find(a => a.id === id); if (!found) throw new Error('Unknown community addon.'); return found; }
  async exclusive(action) {
    if (this.busy) throw new Error('Wait for the current community addon operation to finish.');
    this.busy = true; try { return await action(); } finally { this.busy = false; }
  }

  // ---- ownership record: only what the launcher installed is ever removed ----
  async record(client) {
    try {
      const data = JSON.parse(await fs.readFile(await safePath(client, RECORD, true), 'utf8'));
      if (data.schema !== 1 || !data.addons || typeof data.addons !== 'object') throw new Error('bad');
      for (const [id, item] of Object.entries(data.addons)) {
        if (!Array.isArray(item.files) || !Array.isArray(item.targets)) throw new Error('bad');
        for (const file of item.files) { filePath(file.path); if (!/^Interface\/(AddOns|PTRXML)(\/|$)/.test(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('bad'); }
        if (!/^[a-z0-9-]+$/.test(id)) throw new Error('bad');
      }
      return data;
    } catch (error) {
      if (error.code === 'ENOENT') return { schema: 1, addons: {} };
      throw new Error('The community addon record is damaged. Remove .coa-launcher/community-addons.json only if you accept losing track of those addons.');
    }
  }
  async saveRecord(client, data) { await atomicJson(await safePath(client, RECORD, true), data); }

  // ---- update check (cached) ----
  async loadCache() {
    if (this.cache) return this.cache;
    this.cache = {};
    if (this.cacheFile) { try { const data = JSON.parse(await fs.readFile(this.cacheFile, 'utf8')); if (data && typeof data === 'object') this.cache = data; } catch {} }
    return this.cache;
  }
  async saveCache() { if (this.cacheFile) { try { await fs.mkdir(path.dirname(this.cacheFile), { recursive: true }); await fs.writeFile(this.cacheFile, JSON.stringify(this.cache)); } catch {} } }

  async api(url) {
    const response = await this.fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
    return response.json();
  }

  // What would be installed now: { version, parts: [{ name, url, size, sha256 }] }.
  async resolve(entry) {
    const { source } = entry;
    if (source.type === 'tarball') {
      return { version: source.versionLabel || source.commit.slice(0, 7), parts: [{ name: `${entry.id}.tar.gz`, url: `https://codeload.github.com/${source.repo}/tar.gz/${source.commit}`, size: 0, sha256: source.sha256 || '' }] };
    }
    const releases = await this.api(`https://api.github.com/repos/${source.repo}/releases?per_page=12`);
    const release = (Array.isArray(releases) ? releases : []).find(r => !r.prerelease && !r.draft && (!source.tag || r.tag_name === source.tag));
    if (!release) throw new Error(`${entry.name}: no stable release was found.`);
    const parts = source.assets.map(({ pattern }) => {
      const asset = (release.assets || []).find(a => new RegExp(pattern).test(a.name));
      if (!asset) throw new Error(`${entry.name} ${release.tag_name} has no file matching ${pattern}.`);
      if (!/\.(zip|tar\.gz|\d{3})$/i.test(asset.name)) throw new Error(`${asset.name} is not an archive the launcher installs.`);
      if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases\/download\//.test(asset.browser_download_url)) throw new Error('Unexpected download address.');
      const digest = /^sha256:([a-f0-9]{64})$/.exec(asset.digest || '');
      return { name: asset.name, url: asset.browser_download_url, size: asset.size, sha256: digest ? digest[1] : '' };
    });
    return { version: release.tag_name, parts };
  }

  // Latest version of one entry; never more than one GitHub look per TTL unless forced.
  async latest(entry, force = false) {
    const cache = await this.loadCache(); const hit = cache[entry.id];
    if (!force && hit && this.now() - hit.at < CHECK_TTL) return hit;
    try {
      const resolved = await this.resolve(entry);
      cache[entry.id] = { at: this.now(), version: resolved.version, size: resolved.parts.reduce((n, p) => n + p.size, 0) };
      await this.saveCache();
    } catch (error) { cache[entry.id] = { at: hit?.at || 0, version: hit?.version || '', size: hit?.size || 0, error: error.message, failedAt: this.now() }; if (!hit) return cache[entry.id]; }
    return cache[entry.id];
  }

  async list(client, { check = true, force = false } = {}) {
    const record = client ? await this.record(client) : { addons: {} };
    const rows = [];
    for (const entry of this.catalog) {
      const owned = record.addons[entry.id];
      let latest = null;
      if (check) latest = await this.latest(entry, force);
      const present = [];
      if (client) {
        for (const target of entry.targets.filter(t => !t.endsWith('*'))) if (await statOrNull(path.join(client, ...target.split('/')))) present.push(target);
      }
      const pinned = entry.source.type === 'tarball';
      rows.push({
        id: entry.id, name: entry.name, description: entry.description, author: entry.author, license: entry.license, licenseUrl: entry.licenseUrl, homepage: entry.homepage,
        warnings: entry.warnings, notes: entry.notes, folders: entry.targets.map(t => t.replace(/^Interface\//, '')), sizeBytes: latest?.size || entry.sizeBytes, unpackedBytes: entry.unpackedBytes,
        installedVersion: owned?.version || '', latestVersion: pinned ? (owned?.version || '') : (latest?.version || ''), pinned,
        status: !owned ? (present.length ? 'foreign' : 'not-installed') : (!pinned && latest?.version && latest.version !== owned.version ? 'update' : 'installed'),
        checkError: latest?.error || ''
      });
    }
    return rows;
  }

  // ---- install / update ----
  async download(parts, dir, label) {
    const total = parts.reduce((n, p) => n + p.size, 0); let done = 0; const started = this.now(); let last = 0;
    const files = [];
    for (const [index, part] of parts.entries()) {
      const file = path.join(dir, `part-${index + 1}`); files.push(file);
      const response = await this.fetch(part.url);
      if (!response.ok || !response.body) throw new Error(`Download failed: ${part.name} (${response.status}).`);
      const hash = crypto.createHash('sha256'); let bytes = 0;
      const meter = new Transform({ transform: (chunk, _enc, next) => {
        hash.update(chunk); bytes += chunk.length; done += chunk.length;
        if (this.now() - last > 400) {
          last = this.now(); const seconds = Math.max(1, (last - started) / 1000); const speed = done / seconds;
          this.notify({ phase: 'community', message: `Downloading ${label}`, done, total, speed, eta: total > done && speed > 0 ? Math.round((total - done) / speed) : 0 });
        }
        next(null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body), meter, fss.createWriteStream(file));
      if (part.size && bytes !== part.size) throw new Error(`${part.name} has the wrong size (got ${bytes}, expected ${part.size}). Try again.`);
      if (part.sha256 && hash.digest('hex') !== part.sha256) { await fs.rm(file, { force: true }); throw new Error(`${part.name} is damaged (checksum mismatch). Try again.`); }
    }
    this.notify({ phase: 'community', message: `Downloaded ${label}`, done: total, total, speed: 0, eta: 0 });
    return files;
  }

  // Joins the parts of a split archive in order (a single part is used as it is).
  async join(files, dir) {
    if (files.length === 1) return files[0];
    const target = path.join(dir, 'joined');
    const out = fss.createWriteStream(target);
    for (const file of files) { await pipeline(fss.createReadStream(file), out, { end: false }); await fs.rm(file, { force: true }); }
    await new Promise((resolve, reject) => out.end(error => error ? reject(error) : resolve()));
    return target;
  }

  tar(args) {
    return new Promise((resolve, reject) => {
      const child = spawn(path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'tar.exe'), args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let err = ''; child.stderr.on('data', d => { err += d; });
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve() : reject(new Error(`Extraction failed: ${err.trim().slice(0, 300) || code}`)));
    });
  }

  // Maps an archive path to the client path of the install folder it belongs to ('' when it belongs to none).
  static mapPath(entry, relative) {
    const full = entry.archive.base === 'AddOns' ? `Interface/AddOns/${relative}` : relative;
    for (const target of entry.targets) {
      if (target.endsWith('*')) { const prefix = target.slice(0, -1); const top = full.split('/').slice(0, 3).join('/'); if (full.split('/').length > 3 && top.startsWith(prefix) && top.split('/').length === 3) return { full, folder: top }; }
      else if (full === target || full.startsWith(target + '/')) return { full, folder: target };
    }
    return null;
  }

  // Files of the extracted archive that belong to the entry's folders and have a plain addon extension.
  async collect(entry, stage) {
    const root = path.join(stage, 'x'); const strip = entry.archive.strip;
    const base = strip ? path.join(root, ...(await this.skipTop(root, strip))) : root;
    const files = []; const skipped = []; const folders = new Set(); let bytes = 0;
    const walk = async prefix => {
      for (const item of await fs.readdir(path.join(base, prefix), { withFileTypes: true })) {
        const relative = prefix + item.name;
        if (item.isSymbolicLink()) throw new Error(`The archive contains a link (${relative}); links are not installed.`);
        if (item.isDirectory()) { await walk(relative + '/'); continue; }
        if (!item.isFile()) throw new Error(`Unsupported file in the archive: ${relative}`);
        const mapped = CommunityAddons.mapPath(entry, relative);
        if (!mapped) continue; // the archive's README, other folders...
        filePath(mapped.full);
        const extension = path.extname(item.name).toLowerCase();
        const ok = extension ? ALLOWED_EXTENSIONS.has(extension) : ALLOWED_PLAIN.test(item.name);
        if (!ok) { skipped.push(mapped.full); continue; }
        const absolute = path.join(base, ...relative.split('/'));
        const size = (await fs.stat(absolute)).size; bytes += size;
        files.push({ path: mapped.full, source: absolute, size, folder: mapped.folder }); folders.add(mapped.folder);
      }
    };
    await walk('');
    if (!files.length) throw new Error(`${entry.name}: the archive holds none of the expected folders.`);
    return { files, skipped, folders: [...folders].sort(), bytes };
  }
  async skipTop(root, count) {
    const parts = [];
    let current = root;
    for (let i = 0; i < count; i++) {
      const items = (await fs.readdir(current, { withFileTypes: true })).filter(d => d.isDirectory());
      if (items.length !== 1) throw new Error('The archive has an unexpected layout.');
      parts.push(items[0].name); current = path.join(current, items[0].name);
    }
    return parts;
  }

  async install(id, client) {
    return this.exclusive(async () => {
      const entry = this.entry(id);
      if (!client || !(await statOrNull(path.join(client, 'Interface')))) throw new Error('Choose your installed client first.');
      const record = await this.record(client);
      const owned = record.addons[id];
      for (const conflict of entry.conflicts) if (await statOrNull(path.join(client, 'Interface', 'AddOns', conflict))) throw new Error(`${entry.name} cannot be installed while the addon folder ${conflict} exists. Remove it first (two copies of the same addon fight each other).`);
      this.notify({ phase: 'community', message: `Looking up ${entry.name}`, done: 0, total: 0 });
      const resolved = await this.resolve(entry);
      await fs.mkdir(this.tmpRoot, { recursive: true });
      const stage = await fs.mkdtemp(path.join(this.tmpRoot, `${id}-`));
      try {
        const files = await this.download(resolved.parts, stage, `${entry.name} ${resolved.version}`);
        const archive = await this.join(files, stage);
        this.notify({ phase: 'community', message: `Checking ${entry.name}`, done: 0, total: 0 });
        if (entry.archive.format === 'zip') checkEntries(await readZipEntries(archive));
        const out = path.join(stage, 'x'); await fs.mkdir(out);
        await this.tar([entry.archive.format === 'zip' ? '-xf' : '-xzf', archive, '-C', out]);
        await fs.rm(archive, { force: true });
        this.notify({ phase: 'community', message: `Installing ${entry.name}`, done: 0, total: 0 });
        const plan = await this.collect(entry, stage);
        // Folders that are not ours are never overwritten.
        const ownedFiles = new Set((owned?.files || []).map(f => f.path.toLowerCase()));
        for (const folder of plan.folders) {
          const absolute = path.join(client, ...folder.split('/'));
          const stat = await statOrNull(absolute);
          if (!stat) continue;
          if (stat.isSymbolicLink()) throw new Error(`${folder} is a link; the launcher does not install into links.`);
          const existing = folder === 'Interface/PTRXML' ? await this.filesUnder(client, folder) : [];
          const foreign = folder === 'Interface/PTRXML' ? existing.filter(f => plan.files.some(p => p.path.toLowerCase() === f.toLowerCase()) && !ownedFiles.has(f.toLowerCase())) : (owned && (owned.targets.includes(folder)) ? [] : ['x']);
          if (foreign.length) throw new Error(`${folder} already exists and was not installed by the launcher. Remove it first or keep your copy.`);
        }
        const installed = await this.apply(entry, client, plan, owned);
        if (owned) await this.pruneEmpty(client, owned.files.filter(f => !installed.some(n => n.path === f.path)), owned.targets.filter(t => !plan.folders.includes(t)));
        record.addons[id] = { version: resolved.version, installedAt: new Date(this.now()).toISOString(), targets: plan.folders, files: installed };
        await this.saveRecord(client, record);
        return { id, version: resolved.version, files: installed.length, folders: plan.folders.map(f => f.replace(/^Interface\//, '')), skipped: plan.skipped.length, skippedExamples: plan.skipped.slice(0, 5), updated: !!owned };
      } finally { await fs.rm(stage, { recursive: true, force: true }); }
    });
  }

  async filesUnder(client, folder) {
    const found = [];
    const walk = async relative => {
      let items; try { items = await fs.readdir(path.join(client, ...relative.split('/')), { withFileTypes: true }); } catch { return; }
      for (const item of items) { const child = `${relative}/${item.name}`; if (item.isDirectory()) await walk(child); else found.push(child); }
    };
    await walk(folder); return found;
  }

  // Replaces the folders: the old owned files are set aside, the new ones copied; on any error the old state returns.
  async apply(entry, client, plan, owned) {
    const backup = path.join(client, '.coa-launcher', 'community-backup', entry.id);
    await fs.rm(backup, { recursive: true, force: true });
    const moved = []; const created = [];
    try {
      for (const file of owned?.files || []) {
        const from = await safePath(client, file.path, true);
        if (!(await statOrNull(from))) continue;
        const to = path.join(backup, ...file.path.split('/')); await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.rename(from, to); moved.push({ from, to });
      }
      const written = [];
      for (const file of plan.files) {
        const target = await safePath(client, file.path, true);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(file.source, target, fss.constants.COPYFILE_EXCL);
        created.push(target);
        written.push({ path: file.path, sha256: await hashFile(target), size: file.size });
      }
      await fs.rm(backup, { recursive: true, force: true });
      return written.sort((a, b) => a.path.localeCompare(b.path));
    } catch (error) {
      for (const target of created) await fs.unlink(target).catch(() => {});
      for (const { from, to } of moved.reverse()) { await fs.mkdir(path.dirname(from), { recursive: true }).catch(() => {}); await fs.rename(to, from).catch(() => {}); }
      throw error;
    }
  }

  // Empty folders left behind by files that were removed; a folder that still holds files of yours stays.
  async pruneEmpty(client, files, targets) {
    const dirs = new Set();
    for (const file of files) { let dir = path.posix.dirname(file.path); while (dir.split('/').length > 2) { dirs.add(dir); dir = path.posix.dirname(dir); } }
    for (const dir of [...dirs].sort((a, b) => b.length - a.length)) await fs.rmdir(path.join(client, ...dir.split('/'))).catch(() => {});
    for (const target of targets) await fs.rmdir(path.join(client, ...target.split('/'))).catch(() => {}); // rmdir only removes an empty folder
  }

  // ---- remove: only files the launcher recorded ----
  async remove(id, client) {
    return this.exclusive(async () => {
      const entry = this.entry(id);
      const record = await this.record(client);
      const owned = record.addons[id];
      if (!owned) throw new Error(`${entry.name} was not installed by the launcher, so the launcher does not remove it.`);
      let removed = 0;
      for (const file of owned.files) {
        const target = await safePath(client, file.path, true);
        if (await statOrNull(target)) { await fs.unlink(target); removed++; }
      }
      await this.pruneEmpty(client, owned.files, owned.targets);
      delete record.addons[id];
      await this.saveRecord(client, record);
      return { id, removed };
    });
  }
}

module.exports = { CommunityAddons, loadCatalog, validateCatalog, readZipEntries, checkEntries, ALLOWED_EXTENSIONS, CHECK_TTL };
