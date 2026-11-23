// Copyright (C) 2026 Duff (Duff-SPP). GPL-3.0-only; see LICENSE and ATTRIBUTION.md at the repository root.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createReadStream, createWriteStream } = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { DownloadThrottle } = require('./download-throttle.cjs');
const { validateManifest, requireCompatibleLauncher, runtimePath, statOrNull, safePath, hashFile, atomicJson } = require('./release-format.cjs');

class ClientUpdater {
  constructor(manifestUrl, { fetchImpl = fetch, notify = () => {}, beforeApply = async () => {}, graphicsCompatibility = () => false, preserveFile = () => false, downloadLimit = () => 0, allowLocalHttp = false, launcherVersion = require('../package.json').version } = {}) {
    this.preserveFile = preserveFile;
    this.url = new URL(manifestUrl);
    if (this.url.protocol !== 'https:' && !(allowLocalHttp && this.url.hostname === '127.0.0.1')) throw new Error('Client releases require HTTPS.');
    this.fetch = fetchImpl; this.notify = notify; this.beforeApply = beforeApply;
    this.launcherVersion = launcherVersion;
    this.graphicsCompatibility = graphicsCompatibility;
    this.throttle = new DownloadThrottle(downloadLimit);
    this.busy = false; this.status = { phase: 'idle', message: 'Ready to check for updates.' };
  }
  emit(phase, message, extra = {}) { this.status = { phase, message, ...extra }; this.notify(this.status); }
  cancel() {
    if (this.busy && !['applying', 'finalizing'].includes(this.status.phase)) {
      this.controller?.abort(new Error('Download paused. You can resume it from the launcher.'));
      this.emit('pausing', 'Pausing and closing files…');
    }
  }
  async exclusive(action) {
    if (this.busy) throw new Error('A client operation is already running.');
    this.busy = true; this.controller = new AbortController();
    try { return await action(this.controller.signal); }
    catch (error) {
      if (this.controller.signal.aborted) {
        const paused = new Error('Download paused. You can resume it from the launcher.');
        paused.code = 'CLIENT_PAUSED';
        this.emit('paused', paused.message);
        throw paused;
      }
      this.emit('error', error.message); throw error;
    }
    finally { this.busy = false; this.controller = null; }
  }
  async metadata(root, name) { return safePath(root, '.coa-launcher/' + name, true); }
  async readState(root) {
    const file = await this.metadata(root, 'state.json');
    let contents;
    try { contents = await fs.readFile(file, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    // Invalid cache contents are recoverable by a full scan; filesystem errors are not.
    try { return validateManifest(JSON.parse(contents)); } catch { return null; }
  }
  async manifest(signal) {
    let response;
    try { response = await this.fetch(this.url, { cache: 'no-store', redirect: 'error', headers: { 'X-CoA-Launcher-Version': this.launcherVersion }, signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) }); }
    catch (error) { if (!signal.aborted) error.serviceUnavailable = true; throw error; }
    if (!response.ok) {
      const error = new Error(response.status === 426 ? 'Update your launcher to the latest version to download, install or repair the client.' : response.status === 404 ? 'No client release has been published yet.' : `Could not check client updates (HTTP ${response.status}).`);
      error.serviceUnavailable = response.status === 429 || response.status >= 500;
      error.noRelease = response.status === 404 || response.status === 410;
      throw error;
    }
    const chunks = []; let bytes = 0;
    try {
      for await (const chunk of response.body) {
        bytes += chunk.length; if (bytes > 32 * 1024 * 1024) break;
        chunks.push(Buffer.from(chunk));
      }
    } catch (error) { if (!signal.aborted && bytes <= 32 * 1024 * 1024) error.serviceUnavailable = true; throw error; }
    if (bytes > 32 * 1024 * 1024) throw new Error('Client manifest is too large.');
    // Paths may contain non-ASCII characters; decode the complete bytes without splitting UTF-8.
    const manifest = validateManifest(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    requireCompatibleLauncher(manifest, this.launcherVersion);
    return manifest;
  }
  async recover(root) {
    const journalFile = await this.metadata(root, 'transaction.json');
    const stat = await statOrNull(journalFile);
    if (!stat) { await this.cleanCacheFiles(root, 'stage', /^\d+$/); return; }
    const journal = JSON.parse(await fs.readFile(journalFile, 'utf8'));
    if (!Array.isArray(journal.entries) || !['applying', 'committed'].includes(journal.phase)) throw new Error('Client recovery record is damaged. Contact support before modifying this folder.');
    if (journal.phase === 'applying') {
      for (let i = journal.entries.length - 1; i >= 0; i--) {
        const entry = journal.entries[i];
        if (runtimePath(entry.path)) {
          // Finish recovery of an old launcher transaction without deleting a live log.
          const target = await safePath(root, entry.path, true);
          const backup = await this.metadata(root, `backup/${i}`);
          if (!(await statOrNull(target)) && await statOrNull(backup)) await fs.rename(backup, target);
          continue;
        }
        const target = await safePath(root, entry.path);
        const backup = await this.metadata(root, `backup/${i}`);
        const stage = await this.metadata(root, `stage/${i}`);
        if (await statOrNull(backup)) { await fs.unlink(target).catch(error => { if (error.code !== 'ENOENT') throw error; }); await fs.rename(backup, target); }
        else if (!entry.existed && !entry.remove && !(await statOrNull(stage))) await fs.unlink(target).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
      // An interrupted state write must never be trusted for a later fast scan.
      await fs.unlink(await this.metadata(root, 'state.json')).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
    for (let i = 0; i < journal.entries.length; i++) {
      for (const kind of ['backup', 'stage']) await fs.unlink(await this.metadata(root, `${kind}/${i}`)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
    await fs.unlink(journalFile);
    await this.cleanCacheFiles(root, 'stage', /^\d+$/);
  }
  async cleanCacheFiles(root, kind, pattern, keep = new Set()) {
    const probe = await this.metadata(root, `${kind}/.probe`);
    const entries = await fs.readdir(path.dirname(probe), { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    for (const entry of entries) {
      if (!entry.isFile() || !pattern.test(entry.name) || keep.has(entry.name)) continue;
      const file = await this.metadata(root, `${kind}/${entry.name}`);
      await fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  async plan(root, manifest, force, signal, fullScan = false) {
    requireCompatibleLauncher(manifest, this.launcherVersion);
    await this.recover(root);
    await this.cleanCacheFiles(root, 'downloads', /^[a-f0-9]{64}\.part$/, new Set(manifest.files.map(file => `${file.sha256}.part`)));
    const old = await this.readState(root);
    const previous = new Map((old?.files || []).map(file => [file.path.toLowerCase(), file]));
    const changes = []; const current = []; const warnings = [];
    let count = 0;
    for (const file of manifest.files) {
      signal.throwIfAborted();
      this.emit('checking', `Checking ${file.path}`, { completed: count++, total: manifest.files.length });
      const target = await safePath(root, file.path); const stat = await statOrNull(target);
      const cached = previous.get(file.path.toLowerCase());
      // A player may enable or disable a patch without changing its contents.
      // Normal updates respect that choice; explicit Repair restores release names.
      let alternate = null;
      if (!stat && ((!force && /\.mpq(?:\.disabled)?$/i.test(file.path)) || (['d3d9.dll', 'dxgi.dll'].includes(file.path.toLowerCase()) && (!force || this.graphicsCompatibility(file.path.toLowerCase()))))) {
        const alternatePath = /\.disabled$/i.test(file.path) ? file.path.slice(0, -9) : file.path + '.DISABLED';
        alternate = await statOrNull(await safePath(root, alternatePath));
      }
      // Always hash mandatory client code: older versions cached preserved DLLs
      // with the published hash even when their local contents were different.
      const mandatoryDll = file.path.toLowerCase() === 'extensions.dll';
      const trusted = !mandatoryDll && !force && !fullScan && cached?.sha256 === file.sha256 && stat?.size === file.size && cached.mtimeMs === stat.mtimeMs && cached.ctimeMs === stat.ctimeMs;
      const matches = trusted || (stat?.size === file.size && await hashFile(target, signal) === file.sha256);
      // Extensions.dll is required client code, not an optional graphics customization.
      // CoA Custom Races: files replaced by an applied module stay until an explicit Repair.
      const preserve = alternate || (!force && !mandatoryDll && stat && !matches && (/\.dll$/i.test(file.path) || this.preserveFile(file.path)));
      if (preserve) warnings.push(`Kept player customization: ${file.path}`);
      else if (!matches) changes.push(file);
      current.push({ ...file, mtimeMs: stat?.mtimeMs, ctimeMs: stat?.ctimeMs });
      previous.delete(file.path.toLowerCase());
    }
    const removed = [];
    const releasePaths = new Set(manifest.files.map(file => file.path.toLowerCase()));
    for (const file of previous.values()) {
      const target = await safePath(root, file.path); const stat = await statOrNull(target);
      if (!stat) continue;
      const alternatePath = /\.mpq\.disabled$/i.test(file.path) ? file.path.slice(0, -9) : /\.mpq$/i.test(file.path) ? file.path + '.DISABLED' : null;
      if (!force && (/\.dll$/i.test(file.path) || (alternatePath && releasePaths.has(alternatePath.toLowerCase())))) {
        warnings.push(`Kept obsolete DLL or patch: ${file.path}`);
        continue;
      }
      if (stat.size === file.size && await hashFile(target, signal) === file.sha256) removed.push(file);
      else warnings.push(`Kept modified obsolete file: ${file.path}`);
    }
    // Keep resumable objects only while a destination still needs them. A crash
    // after commit (or a failed final unlink) can otherwise retain a full client.
    await this.cleanCacheFiles(root, 'downloads', /^[a-f0-9]{64}\.part$/, new Set(changes.map(file => `${file.sha256}.part`)));
    return { manifest, changes, removed, warnings, current, bytes: changes.reduce((n, file) => n + file.size, 0) };
  }
  check(root, force = false, allowCached = false) {
    return this.exclusive(async signal => {
      this.emit('checking', 'Checking for a client release…');
      let manifest; let offline = false;
      try { manifest = await this.manifest(signal); }
      catch (error) {
        // This edition's full client is not published. A 404 must not stop Play on a client the player already has.
        if (error.noRelease) {
          this.emit('ready', 'No published client release. Playing the client already on this PC.');
          return { needsUpdate: false, files: 0, removed: 0, bytes: 0, warnings: [] };
        }
        if (!allowCached || !root || !error.serviceUnavailable || signal.aborted) throw error;
        manifest = await this.readState(root);
        if (!manifest) throw new Error('The update service is unavailable and no verified client release is saved. Try again when the service is available.');
        offline = true;
      }
      if (!root) { this.emit('available', 'Client is available to install.', { version: manifest.version }); return { version: manifest.version, files: manifest.files.length, bytes: manifest.files.reduce((n, file) => n + file.size, 0), needsUpdate: true }; }
      const plan = await this.plan(root, manifest, force, signal, offline);
      const needsUpdate = !!(plan.changes.length || plan.removed.length);
      if (offline && needsUpdate) throw new Error('The update service is unavailable and the installed client needs repair. Try again when the service is available.');
      if (!needsUpdate) await atomicJson(await this.metadata(root, 'state.json'), { ...manifest, files: plan.current });
      if (offline) plan.warnings.push('Update service unavailable. Verified your installed release; new updates could not be checked.');
      this.emit(needsUpdate ? 'available' : 'ready', needsUpdate ? 'A client update is ready.' : offline ? plan.warnings[0] : 'Your client is up to date.', { version: manifest.version, warnings: plan.warnings });
      return { version: manifest.version, files: plan.changes.length, removed: plan.removed.length, bytes: plan.bytes, needsUpdate, warnings: plan.warnings };
    });
  }
  async requiredSpace(root, plan, sharedStaging = true) {
    let remaining = 0, duplicateBytes = 0;
    const seen = new Set();
    for (const file of plan.changes) {
      if (seen.has(file.sha256)) { duplicateBytes += file.size; continue; }
      seen.add(file.sha256);
      const stat = await statOrNull(await this.metadata(root, `downloads/${file.sha256}.part`));
      remaining += file.size - Math.min(file.size, stat?.size || 0);
    }
    return remaining + (sharedStaging ? duplicateBytes : plan.bytes) + 256 * 1024 ** 2;
  }
  async supportsSharedStaging(root) {
    const source = await this.metadata(root, 'staging-link-probe');
    const linked = await this.metadata(root, 'staging-link-probe-linked');
    await fs.mkdir(path.dirname(source), { recursive: true });
    // These fixed launcher-owned probe files may survive an interrupted probe.
    for (const file of [linked, source]) await fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
    const handle = await fs.open(source, 'wx'); await handle.close();
    try { await fs.link(source, linked); return true; }
    catch (error) {
      if (['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'EINVAL', 'EISDIR'].includes(error.code)) return false;
      throw error;
    } finally {
      for (const file of [linked, source]) await fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  async download(root, file, signal, report) {
    const part = await this.metadata(root, `downloads/${file.sha256}.part`);
    await fs.mkdir(path.dirname(part), { recursive: true });
    const verify = () => hashFile(part, signal, bytes => this.emit('verifying', `Verifying ${file.path}`, { bytes, totalBytes: file.size }));
    for (let attempt = 0; attempt < 3; attempt++) {
      signal.throwIfAborted();
      let size = (await statOrNull(part))?.size || 0;
      if (size > file.size) { await fs.unlink(part); size = 0; }
      if (size === file.size && await statOrNull(part)) {
        this.emit('verifying', `Verifying cached ${file.path}`);
        if (await verify() === file.sha256) { report(file.size); return part; }
        await fs.unlink(part); size = 0;
      }
      const timeout = new AbortController();
      let timer = setTimeout(() => timeout.abort(new Error('Download timed out.')), 30000);
      let handle;
      try {
        const response = await this.fetch(new URL(`objects/${file.sha256}`, this.url), { redirect: 'error', headers: { 'X-CoA-Launcher-Version': this.launcherVersion, 'Accept-Encoding': 'identity', ...(size ? { Range: `bytes=${size}-` } : {}) }, signal: AbortSignal.any([signal, timeout.signal]) });
        if (response.status === 426) { await response.body?.cancel(); const error = new Error('Update your launcher to the latest version to download, install or repair the client.'); error.code = 'LAUNCHER_UPDATE_REQUIRED'; throw error; }
        if (response.status !== 200 && response.status !== 206) { await response.body?.cancel(); throw new Error(`Download returned HTTP ${response.status}.`); }
        if (response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity') throw new Error('Download server must send uncompressed file bytes.');
        if (response.status === 206 && response.headers.get('content-range') !== `bytes ${size}-${file.size - 1}/${file.size}`) throw new Error('Download server returned an invalid resume range.');
        if (response.status === 200) size = 0;
        handle = await fs.open(part, size ? 'a' : 'w');
        report(size); let lastReport = Date.now();
        for await (const chunk of response.body) {
          // Intentional throttling and disk writes are not a stalled network.
          clearTimeout(timer);
          signal.throwIfAborted();
          if (size + chunk.length > file.size) throw new Error('Downloaded file exceeds its published size.');
          for (let offset = 0; offset < chunk.length; offset += 64 * 1024) {
            const slice = chunk.subarray(offset, Math.min(chunk.length, offset + 64 * 1024));
            await this.throttle.consume(slice.length, signal);
            signal.throwIfAborted();
            await handle.writeFile(slice); size += slice.length;
            if (this.throttle.limit() > 0 && Date.now() - lastReport >= 200) { report(size); lastReport = Date.now(); }
          }
          if (Date.now() - lastReport >= 200 || size === file.size) { report(size); lastReport = Date.now(); }
          timer = setTimeout(() => timeout.abort(new Error('Download stalled.')), 30000);
        }
        clearTimeout(timer);
        this.emit('verifying', `Flushing downloaded ${file.path} to disk…`);
        signal.throwIfAborted();
        await handle.sync(); await handle.close(); handle = null;
        if (size !== file.size) throw new Error('Download was incomplete.');
        if (await verify() !== file.sha256) { await fs.unlink(part); throw new Error('Downloaded file failed verification. Retrying…'); }
        return part;
      } catch (error) {
        if (signal.aborted || error.code === 'LAUNCHER_UPDATE_REQUIRED' || attempt === 2) throw error;
        report(0);
        this.emit('downloading', `Retrying ${file.path} (${attempt + 2}/3): ${error.message}`);
      }
      finally { clearTimeout(timer); timeout.abort(); if (handle) await handle.close(); }
    }
  }
  update(root, force = false, deferReady = false) {
    return this.exclusive(async signal => {
      if (!root) throw new Error('Choose a game installation folder first.');
      await fs.mkdir(root, { recursive: true });
      await this.beforeApply();
      this.emit('checking', 'Preparing your client…');
      const manifest = await this.manifest(signal);
      const plan = await this.plan(root, manifest, force, signal);
      const disk = await fs.statfs(root);
      const sharedStaging = plan.changes.length ? await this.supportsSharedStaging(root) : true;
      const required = await this.requiredSpace(root, plan, sharedStaging);
      if (disk.bavail * disk.bsize < required) throw new Error(`Not enough free space. Allow ${(required / 1024 ** 3).toFixed(1)} GiB of free space to finish this update.`);
      let completed = 0;
      const objects = new Map(plan.changes.map(file => [file.sha256, file]));
      const totalBytes = [...objects.values()].reduce((sum, file) => sum + file.size, 0);
      const verified = new Map();
      const downloaded = [];
      for (const file of plan.changes) {
        let part = verified.get(file.sha256);
        if (!part) {
          part = await this.download(root, file, signal, size => this.emit('downloading', `Downloading ${file.path}`, { bytes: completed + size, totalBytes, version: manifest.version }));
          verified.set(file.sha256, part); completed += file.size;
        }
        downloaded.push(part);
      }
      signal.throwIfAborted(); await this.beforeApply();
      const entries = [];
      let staged = 0;
      const linkedObjects = new Set();
      for (let i = 0; i < plan.changes.length; i++) {
        signal.throwIfAborted();
        const file = plan.changes[i]; const target = await safePath(root, file.path);
        const stage = await this.metadata(root, `stage/${i}`);
        const report = () => this.emit('staging', `Preparing ${file.path}`, { bytes: staged, totalBytes: plan.bytes, version: manifest.version });
        report();
        await fs.mkdir(path.dirname(stage), { recursive: true });
        let lastReport = Date.now();
        const progress = new Transform({ transform(chunk, encoding, callback) {
          staged += chunk.length;
          if (Date.now() - lastReport >= 200) { report(); lastReport = Date.now(); }
          callback(null, chunk);
        } });
        if (sharedStaging) {
          // A hard link adds a name, not another copy of the verified bytes.
          // Downloads remain available for resume and transaction rollback.
          signal.throwIfAborted();
          // Distinct installed files must remain independent even when their
          // initial contents match, so only one destination shares each object.
          if (linkedObjects.has(file.sha256)) await fs.copyFile(downloaded[i], stage);
          else { await fs.link(downloaded[i], stage); linkedObjects.add(file.sha256); }
          staged += file.size;
        } else {
          await pipeline(createReadStream(downloaded[i]), progress, createWriteStream(stage), { signal });
        }
        report();
        entries.push({ path: file.path, existed: !!(await statOrNull(target)), remove: false });
      }
      for (const file of plan.removed) entries.push({ path: file.path, existed: true, remove: true });
      signal.throwIfAborted(); await this.beforeApply();
      const journalFile = await this.metadata(root, 'transaction.json');
      await atomicJson(journalFile, { phase: 'applying', entries });
      this.emit('applying', 'Applying verified files. Please keep the launcher open.');
      try {
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i]; const target = await safePath(root, entry.path);
          this.emit('applying', `Applying ${entry.path}. Please keep the launcher open.`, { completed: i, total: entries.length });
          const backup = await this.metadata(root, `backup/${i}`);
          await fs.mkdir(path.dirname(target), { recursive: true }); await fs.mkdir(path.dirname(backup), { recursive: true });
          if (entry.existed) await fs.rename(target, backup);
          if (!entry.remove) await fs.rename(await this.metadata(root, `stage/${i}`), target);
        }
        this.emit('finalizing', 'Finalizing client state. Please keep the launcher open.');
        const files = [];
        for (const file of manifest.files) { const stat = await statOrNull(await safePath(root, file.path)); files.push({ ...file, mtimeMs: stat?.mtimeMs, ctimeMs: stat?.ctimeMs }); }
        await atomicJson(await this.metadata(root, 'state.json'), { ...manifest, files });
        await atomicJson(journalFile, { phase: 'committed', entries });
      } catch (error) { await this.recover(root); throw error; }
      this.emit('finalizing', 'Cleaning up verified downloads and update backups…');
      await this.recover(root);
      for (const part of new Set(downloaded)) await fs.unlink(part).catch(() => {});
      this.emit(deferReady ? 'finalizing' : 'ready', deferReady ? 'Preparing required client settings and addons…' : 'Your client is up to date. Ready to play.', { version: manifest.version, warnings: plan.warnings });
      return { version: manifest.version, warnings: plan.warnings };
    });
  }
}
module.exports = { ClientUpdater };
