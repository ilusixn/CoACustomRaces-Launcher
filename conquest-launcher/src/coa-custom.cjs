// CoA Custom Races additions to Conquest Launcher (originally developed by Duff (Duff-SPP)).
// GPL-3.0-only; see LICENSE and ATTRIBUTION.md at the repository root.
// Creates a local server from Corfirean's public CoA server build, applies optional modules
// (SQUID Playerbots, ilusixn Dev Menu, CoA Custom Races V2) and sets the realm address
// for local, LAN or LogMeIn Hamachi play.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const SOURCES = {
  server: 'Corfirean/coa-server-build',
  squidAddon: 'Zyth45/squidbots-addon',
  devMenu: 'ilusixn/ilusixn-dev-menu',
  races: 'ilusixn/CustomRacesCoa'
};
const RACES_TAG = 'coa-custom-2.0';

function hostnameOk(value) { return typeof value === 'string' && /^[a-zA-Z0-9.-]{1,253}$/.test(value); }

// Private IPv4 addresses of this PC. Hamachi uses 25.0.0.0/8 on an adapter named "Hamachi".
function networkAddresses() {
  const lan = []; const hamachi = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const entry of list || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (/hamachi/i.test(name) || entry.address.startsWith('25.')) hamachi.push(entry.address);
      else if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address) && !/vethernet|virtualbox|vmware|wsl|docker/i.test(name)) lan.push(entry.address);
    }
  }
  return { lan, hamachi };
}

class CoaCustom {
  constructor({ fetchImpl, notify }) { this.fetch = fetchImpl; this.notify = notify; this.busy = false; }

  emit(phase, message, extra = {}) { this.notify({ phase, message, ...extra }); }

  async exclusive(action) {
    if (this.busy) throw new Error('Wait for the current server or module operation to finish.');
    this.busy = true;
    try { return await action(); } finally { this.busy = false; }
  }

  async latestRelease(repo, tag = '') {
    const url = `https://api.github.com/repos/${repo}/releases/${tag ? `tags/${tag}` : 'latest'}`;
    const response = await this.fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`GitHub release ${repo} ${tag || 'latest'} is unavailable (${response.status}).`);
    return response.json();
  }

  asset(release, test) {
    const found = release.assets.find(a => typeof test === 'string' ? a.name === test : test.test(a.name));
    if (!found) throw new Error(`${release.tag_name} has no file ${test}.`);
    return found;
  }

  // Streams a file to disk with progress; verifies SHA-256 when given.
  async download(url, file, { sha256 = '', label = path.basename(file), size = 0 } = {}) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const response = await this.fetch(url);
    if (!response.ok || !response.body) throw new Error(`Download failed: ${label} (${response.status}).`);
    const total = Number(response.headers.get('content-length')) || size;
    const hash = crypto.createHash('sha256');
    let done = 0; let last = 0;
    const meter = new Transform({ transform: (chunk, _enc, next) => {
      hash.update(chunk); done += chunk.length;
      if (Date.now() - last > 500) { last = Date.now(); this.emit('download', `Downloading ${label}`, { done, total }); }
      next(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(file));
    const digest = hash.digest('hex');
    if (sha256 && digest !== sha256.toLowerCase()) { await fsp.rm(file, { force: true }); throw new Error(`${label} is damaged (checksum mismatch). Try again.`); }
    return file;
  }

  // Windows tar.exe (bsdtar) reads zip and tar files.
  tar(args, input = null) {
    return new Promise((resolve, reject) => {
      const child = spawn(path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'tar.exe'), args, { windowsHide: true, stdio: [input ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
      let err = '';
      child.stderr.on('data', d => { err += d; });
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve() : reject(new Error(`Extraction failed: ${err.trim().slice(0, 300) || code}`)));
      if (input) input(child.stdin).catch(reject);
    });
  }

  async extractZip(zip, inner, dest) {
    await fsp.mkdir(dest, { recursive: true });
    const strip = inner.split('/').filter(Boolean).length;
    await this.tar(['-xf', zip, '-C', dest, ...(strip ? ['--strip-components', String(strip), `${inner.replace(/\/$/, '')}/*`] : [])]);
  }

  async zipHas(zip, inner) {
    return new Promise(resolve => {
      const child = spawn(path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'tar.exe'), ['-tf', zip], { windowsHide: true });
      let out = ''; child.stdout.on('data', d => { out += d; });
      child.on('close', () => resolve(out.split(/\r?\n/).some(line => line.startsWith(inner))));
      child.on('error', () => resolve(false));
    });
  }

  // ---------- server ----------

  async createServer(dest) {
    return this.exclusive(async () => {
      dest = path.resolve(dest);
      const existing = await fsp.readdir(dest).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
      if (existing.length) throw new Error('Choose an empty folder for the server.');
      this.emit('server', 'Finding the latest CoA server…');
      const release = await this.latestRelease(SOURCES.server);
      const manifestFile = path.join(dest + '.download', 'install-manifest.json');
      await this.download(this.asset(release, 'install-manifest.json').browser_download_url, manifestFile, { label: 'server manifest' });
      const manifest = JSON.parse(await fsp.readFile(manifestFile, 'utf8'));
      const parts = manifest.archive?.parts;
      if (manifest.archive?.format !== 'tar.zst' || !Array.isArray(parts) || !parts.length) throw new Error('The server package format is not supported by this launcher.');
      const needed = parts.reduce((n, p) => n + p.size, 0) + manifest.archive.unpackedSize;
      const free = await fsp.statfs(path.parse(dest).root).then(s => s.bavail * s.bsize).catch(() => Infinity);
      if (free < needed) throw new Error(`Not enough free space: about ${Math.ceil(needed / 2 ** 30)} GB needed.`);
      // shortcut: parts are checked against the manifest's SHA-256, the manifest signature (.sig) is not verified; add it if the package moves off GitHub.
      const files = [];
      for (const part of parts) {
        const file = path.join(dest + '.download', part.name);
        const ok = await fsp.stat(file).then(s => s.size === part.size).catch(() => false);
        if (!ok) await this.download(this.asset(release, part.name).browser_download_url, file, { sha256: part.sha256, size: part.size, label: `server ${part.name}` });
        files.push(file);
      }
      const staging = dest + '.installing';
      await fsp.rm(staging, { recursive: true, force: true });
      await fsp.mkdir(staging, { recursive: true });
      this.emit('server', 'Unpacking the server (about 10 GB, this takes a while)…');
      await this.tar(['-x', '-f', '-', '-C', staging], async stdin => {
        const joined = Readable.from((async function* () { for (const f of files) for await (const chunk of fs.createReadStream(f)) yield chunk; })());
        await pipeline(joined, zlib.createZstdDecompress(), stdin);
      });
      this.emit('server', 'Preparing the server…');
      // The package's scripts render their config from Settings/database.json at first start.
      await fsp.copyFile(path.join(staging, 'Settings/database.bootstrap.json'), path.join(staging, 'Settings/database.json'));
      await this.materializeModuleConfigs(staging);
      await fsp.rm(dest, { recursive: true, force: true });
      await fsp.rename(staging, dest);
      await fsp.rm(dest + '.download', { recursive: true, force: true });
      this.emit('ready', `Server ${release.tag_name} is ready.`);
      return { path: dest, version: release.tag_name };
    });
  }

  async materializeModuleConfigs(root) {
    const dir = path.join(root, 'Core/configs/modules');
    for (const name of await fsp.readdir(dir).catch(() => [])) {
      const stem = name.endsWith('.conf.dist') ? name.slice(0, -10) : null;
      if (!stem || stem === 'coa_bugreport' || stem === 'mod_ascension_compat') continue;
      const active = path.join(dir, `${stem}.conf`);
      if (!fs.existsSync(active)) await fsp.copyFile(path.join(dir, name), active);
    }
  }

  async setConf(root, file, key, value) {
    const target = path.join(root, 'Core/configs/modules', file);
    if (!fs.existsSync(target)) {
      if (!fs.existsSync(target + '.dist')) throw new Error(`${file} is missing from the server.`);
      await fsp.copyFile(target + '.dist', target);
    }
    const text = await fsp.readFile(target, 'utf8');
    const line = new RegExp(`^\\s*${key.replace(/\./g, '\\.')}\\s*=.*$`, 'm');
    await fsp.writeFile(target, line.test(text) ? text.replace(line, `${key} = ${value}`) : `${text.trimEnd()}\n${key} = ${value}\n`);
  }

  manage(root, verb) {
    const python = path.join(root, 'Runtime/python/python.exe');
    const script = path.join(root, 'Scripts/manage.py');
    if (!fs.existsSync(python) || !fs.existsSync(script)) return Promise.reject(new Error('This folder is not a CoA server (Scripts/manage.py is missing).'));
    return new Promise((resolve, reject) => {
      const child = spawn(python, [script, verb], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', d => { out += d; this.emit('server', String(d).trim().split(/\r?\n/).pop().slice(0, 200)); });
      child.stderr.on('data', d => { out += d; });
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve(out) : reject(new Error(`Server ${verb} failed: ${out.trim().split(/\r?\n/).slice(-3).join(' ').slice(0, 400)}`)));
    });
  }

  async sql(root, statement) {
    const db = JSON.parse(await fsp.readFile(path.join(root, 'Settings/database.json'), 'utf8'));
    const repack = JSON.parse(await fsp.readFile(path.join(root, 'Settings/repack.json'), 'utf8'));
    const mysql = path.join(root, 'mysql/bin/mysql.exe');
    return new Promise((resolve, reject) => {
      // MYSQL_PWD keeps the password off the process command line.
      const child = spawn(mysql, ['-h127.0.0.1', `-P${repack.mysqlPort || 3306}`, '-uroot', '-e', statement], { windowsHide: true, env: { ...process.env, MYSQL_PWD: db.rootPassword } });
      let err = ''; child.stderr.on('data', d => { err += d; });
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve() : reject(new Error(`Database update failed: ${err.trim().slice(0, 300)}`)));
    });
  }

  async startServer(root, realmAddress) {
    return this.exclusive(async () => {
      this.emit('server', 'Starting the server (first start can take several minutes)…');
      await this.manage(root, 'start-all');
      // start-all resets the realm address to 127.0.0.1; put the chosen one back (authserver re-reads it within seconds).
      if (realmAddress && realmAddress !== '127.0.0.1') await this.setRealmAddress(root, realmAddress);
      this.emit('ready', 'Server is running.');
    });
  }

  async stopServer(root) {
    return this.exclusive(async () => { this.emit('server', 'Stopping the server…'); await this.manage(root, 'stop-all'); this.emit('ready', 'Server stopped.'); });
  }

  async setRealmAddress(root, address) {
    if (!hostnameOk(address)) throw new Error('Invalid realm address.');
    await this.sql(root, `UPDATE acore_auth.realmlist SET address='${address}', localAddress='127.0.0.1' WHERE id=1;`);
  }

  // ---------- modules ----------

  async applyModules({ serverPath, clientPath, squid, devMenu, races }) {
    return this.exclusive(async () => {
      const owned = [];
      const tmp = path.join(os.tmpdir(), 'coa-custom-launcher');
      await fsp.mkdir(tmp, { recursive: true });
      const addons = clientPath ? path.join(clientPath, 'Interface/AddOns') : '';

      if (serverPath) {
        await this.setConf(serverPath, 'playerbots.conf', 'AiPlayerbot.Enabled', squid ? 1 : 0);
        await this.setConf(serverPath, 'coa_custom_races.conf', 'CoACustomRaces.Enable', races ? 1 : 0);
      }
      if (squid && addons) {
        this.emit('modules', 'Getting the latest SquidBots addon…');
        const release = await this.latestRelease(SOURCES.squidAddon);
        const zip = await this.download(this.asset(release, /\.zip$/i).browser_download_url, path.join(tmp, 'squidbots.zip'), { label: `SquidBots ${release.tag_name}` });
        await this.extractZip(zip, '', addons);
      }
      if (devMenu && addons) {
        this.emit('modules', 'Getting the Dev Menu addon…');
        const release = await this.latestRelease(SOURCES.devMenu);
        const zip = await this.download(this.asset(release, /addon.*\.zip$/i).browser_download_url, path.join(tmp, 'devmenu-addon.zip'), { label: `Dev Menu ${release.tag_name}` });
        await this.extractZip(zip, '', addons);
      }
      if (races && clientPath) {
        const release = await this.latestRelease(SOURCES.races, RACES_TAG);
        const zips = release.assets.filter(a => /^CoA-Custom-V2-Client-\d+\.zip$/.test(a.name)).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
        if (!zips.length) throw new Error('The Custom Races release has no client files.');
        for (const [index, asset] of zips.entries()) {
          const zip = await this.download(asset.browser_download_url, path.join(tmp, asset.name), { label: `Custom Races ${index + 1}/${zips.length}`, size: asset.size });
          this.emit('modules', `Installing Custom Races ${index + 1}/${zips.length}…`);
          for (const [inner, target] of [['CoA-Custom/files/client/', path.join(clientPath, 'Data')], ['CoA-Custom/files/client_root/', clientPath], ['CoA-Custom/files/addons/', addons]]) {
            if (await this.zipHas(zip, inner)) await this.extractZip(zip, inner, target);
          }
          await fsp.rm(zip, { force: true });
        }
        // Files the client manifest also ships; the updater must keep them (see main.cjs preserveFile).
        owned.push('Data/patch-T.MPQ', 'Data/patch-ZG.MPQ');
      }
      const notes = [];
      if (devMenu) notes.push('Dev Menu: the addon is installed. Its server part needs a worldserver built with mod-ilusixn-devmenu.');
      if (races && serverPath) notes.push('Custom Races: switched on in the server. Restart the server to apply.');
      this.emit('ready', 'Modules applied.');
      return { owned, notes };
    });
  }
}

module.exports = { CoaCustom, networkAddresses, hostnameOk, SOURCES };
