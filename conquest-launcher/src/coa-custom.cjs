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
const RACES_FILE = 'https://raw.githubusercontent.com/ilusixn/CustomRacesCoa/HEAD/RACES.md';
const STANDARD_RACES = [[1, 'Human', 'Alliance'], [2, 'Orc', 'Horde'], [3, 'Dwarf', 'Alliance'], [4, 'Night Elf', 'Alliance'], [5, 'Undead', 'Horde'], [6, 'Tauren', 'Horde'], [7, 'Gnome', 'Alliance'], [8, 'Troll', 'Horde'], [10, 'Blood Elf', 'Horde'], [11, 'Draenei', 'Alliance']]
  .map(([id, name, side]) => ({ ids: [id], name, side, credit: 'Blizzard (standard race)', notes: '', standard: true }));
const RACE_CLIENT_ZIP = /^CoA-Custom-V[\d.]+-Client-\d+\.zip$/;
const LEDGER = 'coa_manager_migrations'; // shared with CoA Server Manager so both tools agree on applied updates
const SCHEMA = { auth: 'acore_auth', characters: 'acore_characters', world: 'acore_world' };

// RACES.md table rows: | 20/29 | Pandaren | Both | credit | notes |
function parseRaces(markdown) {
  const rows = [];
  for (const line of markdown.split(/\r?\n/)) {
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length < 4 || !/^\d+(\/\d+)*$/.test(cells[0])) continue;
    rows.push({ ids: cells[0].split('/').map(Number), name: cells[1], side: cells[2], credit: cells[3], notes: cells[4] || '' });
  }
  return rows;
}

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
  // serverRepository: GitHub repo whose releases hold the server package (default: the built-in source above).
  constructor({ fetchImpl, notify, serverRepository = '' }) { this.fetch = fetchImpl; this.notify = notify; this.busy = false; this.sources = { ...SOURCES, ...(serverRepository ? { server: serverRepository } : {}) }; }

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
      const release = await this.latestRelease(this.sources.server);
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
      await this.disableCompanions(staging);
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

  // CoA Companions refuses to run next to SquidBots and this launcher does not offer it, so it is always off.
  async disableCompanions(root) { await this.setConf(root, 'mod_coa_playerbots.conf', 'CoaBots.Enable', 0).catch(() => {}); }

  async setConf(root, file, key, value) {
    const target = path.join(root, 'Core/configs/modules', file);
    if (!fs.existsSync(target)) {
      if (!fs.existsSync(target + '.dist')) throw new Error(`${file} is missing from the server.`);
      await fsp.copyFile(target + '.dist', target);
    }
    const text = await fsp.readFile(target, 'utf8');
    const line = new RegExp(`^[ \\t]*${key.replace(/\./g, '\\.')}[ \\t]*=.*$`, 'm');
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

  // Runs SQL with the server's own mysql.exe; returns tab-separated rows. With `file`, the file is fed on stdin.
  async sql(root, statement, { schema = '', file = '', stream = null, tolerant = false } = {}) {
    const db = JSON.parse(await fsp.readFile(path.join(root, 'Settings/database.json'), 'utf8'));
    const repack = JSON.parse(await fsp.readFile(path.join(root, 'Settings/repack.json'), 'utf8'));
    const mysql = path.join(root, 'mysql/bin/mysql.exe');
    const args = ['-h127.0.0.1', `-P${repack.mysqlPort || 3306}`, '-uroot', '-N', '-B', '--default-character-set=utf8mb4', ...(tolerant ? ['--force'] : []), ...(schema ? [schema] : []), ...(file || stream ? [] : ['-e', statement])];
    return new Promise((resolve, reject) => {
      // MYSQL_PWD keeps the password off the process command line.
      const child = spawn(mysql, args, { windowsHide: true, env: { ...process.env, MYSQL_PWD: db.rootPassword }, stdio: [file || stream ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
      let out = ''; let err = '';
      child.stdout.on('data', d => { out += d; });
      child.stderr.on('data', d => { err += d; });
      child.on('error', reject);
      // tolerant (re-running a release's SQL): rows/tables/columns that already exist are expected, anything else is a real error
      child.on('close', code => {
        const real = err.split('\n').filter(l => /ERROR [0-9]+/.test(l) && !(tolerant && /ERROR (1062|1050|1060|1061|1068) /.test(l)));
        if (code === 0 || (tolerant && !real.length)) resolve(out);
        else reject(new Error(`Database error: ${(tolerant ? real.join(' ') : err).trim().slice(0, 300)}`));
      });
      if (file) fs.createReadStream(file).on('error', reject).pipe(child.stdin);
      if (stream) stream.on('error', reject).pipe(child.stdin);
    });
  }

  sqlFile(root, schema, file, tolerant = false) { return this.sql(root, '', { schema, file, tolerant }); }

  async startServer(root, realmAddress) {
    return this.exclusive(async () => {
      this.emit('server', 'Starting the server (first start can take several minutes)…');
      await this.disableCompanions(root);
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

  tmpDir() { const dir = path.join(os.tmpdir(), 'coa-custom-launcher'); fs.mkdirSync(dir, { recursive: true }); return dir; }

  async installAddon(repo, pattern, label, addons) {
    this.emit('modules', `Getting the latest ${label}…`);
    const release = await this.latestRelease(repo);
    const zip = await this.download(this.asset(release, pattern).browser_download_url, path.join(this.tmpDir(), `${label.replace(/\W+/g, '')}.zip`), { label: `${label} ${release.tag_name}` });
    await this.extractZip(zip, '', addons);
    await fsp.rm(zip, { force: true });
    return release.tag_name;
  }

  async installRaces(clientPath) {
    const release = await this.latestRelease(SOURCES.races);
    const zips = release.assets.filter(a => RACE_CLIENT_ZIP.test(a.name)).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
    if (!zips.length) throw new Error('The Custom Races release has no client files.');
    for (const [index, asset] of zips.entries()) {
      const zip = await this.download(asset.browser_download_url, path.join(this.tmpDir(), asset.name), { label: `Custom Races ${index + 1}/${zips.length}`, size: asset.size });
      this.emit('modules', `Installing Custom Races ${index + 1}/${zips.length}…`);
      for (const [inner, target] of [['CoA-Custom/files/client/', path.join(clientPath, 'Data')], ['CoA-Custom/files/client_root/', clientPath], ['CoA-Custom/files/addons/', path.join(clientPath, 'Interface/AddOns')]]) {
        if (await this.zipHas(zip, inner)) await this.extractZip(zip, inner, target);
      }
      await fsp.rm(zip, { force: true });
    }
    return release.tag_name;
  }

  // Optional core of a Custom Races release: CoA-Custom-V*-Core.zip holding a worldserver.exe built for THIS server's base
  // (the plain Server zip's worldserver.exe is for the CoA-Bots repack and is never used). Boats/elevators need it.
  // The replaced files are kept once in Core/before-races. Servers stay stopped (caller did stop-all).
  async updateRacesCore(root, release) {
    const asset = release.assets.find(a => /^CoA-Custom-V[\d.]+-Core\.zip$/.test(a.name));
    if (!asset) { this.emit('server', 'This release has no core file; the server program was left as it is.'); return false; }
    const work = path.join(this.tmpDir(), 'races-core');
    await fsp.rm(work, { recursive: true, force: true });
    const zip = await this.download(asset.browser_download_url, path.join(work, asset.name), { label: `Custom Races core ${release.tag_name}`, size: asset.size });
    const out = path.join(work, 'x');
    await this.extractZip(zip, '', out);
    const found = (await fsp.readdir(out, { recursive: true })).find(n => /(^|[\\/])worldserver\.exe$/i.test(n));
    if (!found) throw new Error('The Custom Races core file has no worldserver.exe.');
    const exe = path.join(out, found);
    const head = Buffer.alloc(2); const fd = await fsp.open(exe, 'r'); await fd.read(head, 0, 2, 0); await fd.close();
    if (head.toString() !== 'MZ' || (await fsp.stat(exe)).size < 20 * 2 ** 20) throw new Error('The Custom Races core worldserver.exe is not valid.');
    // The exe and the DLLs it was built against travel together (its OpenSSL/MySQL/runtime DLLs differ from the base server's).
    const core = path.join(root, 'Core'); const keep = path.join(core, 'before-races'); await fsp.mkdir(keep, { recursive: true });
    this.emit('server', 'Replacing the server program…');
    for (const name of (await fsp.readdir(path.dirname(exe))).filter(n => /^worldserver[.]exe$|[.]dll$/i.test(n))) {
      if (!fs.existsSync(path.join(keep, name)) && fs.existsSync(path.join(core, name))) await fsp.copyFile(path.join(core, name), path.join(keep, name));
      await fsp.copyFile(path.join(path.dirname(exe), name), path.join(core, name));
    }
    await fsp.rm(work, { recursive: true, force: true });
    return true;
  }

  // Server half of a Custom Races release (CoA-Custom-V*-Server.zip): server DBCs, the module config and the world SQL
  // (NPC placement, race starts, racials...). Same steps as the release's install.py, which re-runs every file on each
  // update. shortcut: worldserver.exe from that zip is NOT used (it is built for the CoA-Bots repack, not this server's core).
  async updateRacesServer(root) {
    const release = await this.latestRelease(SOURCES.races);
    const asset = release.assets.find(a => /^CoA-Custom-V[\d.]+-Server\.zip$/.test(a.name));
    if (!asset) throw new Error(`${release.tag_name} has no server file (CoA-Custom-V…-Server.zip).`);
    const work = path.join(this.tmpDir(), 'races-server');
    await fsp.rm(work, { recursive: true, force: true });
    const zip = await this.download(asset.browser_download_url, path.join(work, asset.name), { label: `Custom Races server ${release.tag_name}`, size: asset.size });
    const files = path.join(work, 'files');
    await this.extractZip(zip, 'CoA-Custom/files/', files);
    const sqls = (await fsp.readdir(path.join(files, 'sql')).catch(() => [])).filter(n => /\.sql$/i.test(n))
      .sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0) || a.localeCompare(b));
    if (!sqls.length) throw new Error('The Custom Races server file has no database updates.');
    await this.backupInternal(root, 'before-update');
    this.emit('server', 'Stopping the server…');
    await this.manage(root, 'stop-all').catch(() => {});
    this.emit('server', 'Copying server files…');
    const copyAll = async (from, to, pick = () => true) => {
      for (const name of await fsp.readdir(from).catch(() => [])) if (pick(name)) { await fsp.mkdir(to, { recursive: true }); await fsp.copyFile(path.join(from, name), path.join(to, name)); }
    };
    await copyAll(path.join(files, 'dbc'), path.join(root, 'Data/dbc'), n => /\.dbc$/i.test(n));
    // With custom races on, the core loads Data/dbc_races/<file> before Data/dbc/<file>: stale copies there hide the new races ("Wrong race N").
    const present = new Set(await fsp.readdir(path.join(root, 'Data/dbc_races')).catch(() => []));
    await copyAll(path.join(files, 'dbc'), path.join(root, 'Data/dbc_races'), n => present.has(n));
    await copyAll(path.join(files, 'dbc_clientset'), path.join(root, 'Data/dbc_clientset'), n => /\.dbc$/i.test(n));
    for (const sub of ['maps', 'vmaps', 'mmaps']) await copyAll(path.join(files, 'server_data', sub), path.join(root, 'Data', sub)); // V2.0.1: map 907 (Fading Island)
    const conf = path.join(root, 'Core/configs/modules');
    await copyAll(path.join(files, 'modules'), conf, n => n === 'coa_custom_races.conf.dist');
    if (!fs.existsSync(path.join(conf, 'coa_custom_races.conf'))) await fsp.copyFile(path.join(conf, 'coa_custom_races.conf.dist'), path.join(conf, 'coa_custom_races.conf')).catch(() => {});
    await this.updateRacesCore(root, release);
    await this.withDatabase(root, async () => {
      for (const [index, name] of sqls.entries()) {
        this.emit('server', `Applying Custom Races database updates… ${index + 1}/${sqls.length}`);
        try { await this.sqlFile(root, 'acore_world', path.join(files, 'sql', name), true); }
        catch (error) { throw new Error(`Custom Races database update ${name} failed: ${error.message}`); }
      }
    });
    await fsp.rm(work, { recursive: true, force: true });
    return release.tag_name;
  }

  // Installs (or updates, with `only`) the chosen modules' files and sets the server switches. Returns installed versions.
  async applyModules({ serverPath, clientPath, squid, devMenu, races, only = null }) {
    return this.exclusive(async () => {
      const versions = {};
      const want = key => only ? only === key : { squid, devMenu, races }[key];
      const addons = clientPath ? path.join(clientPath, 'Interface/AddOns') : '';
      if (serverPath && !only) {
        await this.setConf(serverPath, 'playerbots.conf', 'AiPlayerbot.Enabled', squid ? 1 : 0);
        await this.setConf(serverPath, 'coa_custom_races.conf', 'CoACustomRaces.Enable', races ? 1 : 0);
        // The module ships with BotsEnable = 0, which keeps every bot on the standard races.
        await this.setConf(serverPath, 'coa_custom_races.conf', 'CoACustomRaces.BotsEnable', races && squid ? 1 : 0);
      }
      if (want('squid') && addons) versions.squid = await this.installAddon(SOURCES.squidAddon, /\.zip$/i, 'SquidBots addon', addons);
      if (want('devMenu') && addons) versions.devMenu = await this.installAddon(SOURCES.devMenu, /addon.*\.zip$/i, 'Dev Menu addon', addons);
      if (want('races') && clientPath) versions.races = await this.installRaces(clientPath);
      const notes = [];
      // The server half carries the NPCs, ferries and race data, so races without it show nothing in game.
      // An own-server package already carries the races' server half (DBC, SQL, core); only the client files are separate.
      const ownServer = !!serverPath && fs.existsSync(path.join(serverPath, 'Settings/own-server.json'));
      if (want('races') && !ownServer) {
        if (!serverPath) notes.push('No server is selected, so only the client was installed. Select your server (Locate server), then update again.');
        else try { versions.races = await this.updateRacesServer(serverPath); } catch (error) { if (only) throw error; notes.push(`Server part skipped: ${error.message}`); }
      }
      if (want('devMenu')) notes.push('Dev Menu: the addon is installed. Its server part needs a worldserver built with mod-ilusixn-devmenu.');
      if (serverPath && !only) notes.push('Restart the server to apply the switches.');
      this.emit('ready', 'Modules applied.');
      // Files the client manifest also ships; the client updater keeps them (main.cjs preserveFile).
      return { versions, owned: want('races') ? ['Data/patch-T.MPQ', 'Data/patch-ZG.MPQ'] : null, notes };
    });
  }

  // ---------- updates ----------

  async latestVersions() {
    const tag = async repo => (await this.latestRelease(repo).catch(() => null))?.tag_name || null;
    const [server, squid, devMenu, races] = await Promise.all([tag(this.sources.server), tag(SOURCES.squidAddon), tag(SOURCES.devMenu), tag(SOURCES.races)]);
    return { server, squid, devMenu, races };
  }

  async ledger(root) {
    const create = ['acore_world', 'acore_auth'].map(schema => `CREATE TABLE IF NOT EXISTS \`${schema}\`.\`${LEDGER}\` (\`db\` VARCHAR(32) NOT NULL, \`id\` VARCHAR(190) NOT NULL, \`sha256\` CHAR(64) NOT NULL, \`status\` VARCHAR(16) NOT NULL, \`applied_at\` DATETIME NOT NULL, \`error\` TEXT NULL, \`baseline\` TINYINT NOT NULL DEFAULT 0, PRIMARY KEY (\`db\`,\`id\`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`).join('');
    const out = await this.sql(root, `${create}SELECT db,id,status FROM acore_world.${LEDGER} UNION ALL SELECT db,id,status FROM acore_auth.${LEDGER};`);
    const rows = new Map();
    for (const line of out.split(/\r?\n/).filter(Boolean)) { const [db, id, status] = line.split('\t'); rows.set(`${db}/${id}`, String(status).toLowerCase()); }
    return rows;
  }

  async recordMigration(root, m, status, baseline = 0) {
    const schema = m.db === 'auth' ? 'acore_auth' : 'acore_world';
    await this.sql(root, `REPLACE INTO \`${schema}\`.\`${LEDGER}\` (db,id,sha256,status,applied_at,error,baseline) VALUES ('${m.db}','${m.id}','${m.sha256}','${status}',NOW(),NULL,${baseline});`);
  }

  // Server update from the latest Corfirean/coa-server-build release: replaces the package's own files (configs,
  // database data and player files stay), then applies the release's new database updates once each.
  async updateServer(root, installedVersion) {
    return this.exclusive(async () => {
      const release = await this.latestRelease(this.sources.server);
      if (release.tag_name === installedVersion) return { version: release.tag_name, applied: 0, upToDate: true };
      const work = path.join(path.dirname(root), path.basename(root) + '.update');
      const manifestFile = path.join(work, 'manifest.json');
      await this.download(this.asset(release, 'manifest.json').browser_download_url, manifestFile, { label: 'server update manifest' });
      const manifest = JSON.parse(await fsp.readFile(manifestFile, 'utf8'));
      if (manifest.kind !== 'update' || manifest.archive?.format !== 'tar.zst') throw new Error('The server update format is not supported by this launcher.');
      for (const m of manifest.migrations) if (!/^[\w.-]+$/.test(m.id) || !SCHEMA[m.db] || !/^[a-f0-9]{64}$/i.test(m.sha256)) throw new Error(`Unexpected database update entry ${m.id}.`);
      const parts = [];
      for (const part of manifest.archive.parts) {
        const file = path.join(work, part.name);
        if (!(await fsp.stat(file).then(s => s.size === part.size).catch(() => false))) await this.download(this.asset(release, part.name).browser_download_url, file, { sha256: part.sha256, size: part.size, label: `server update ${part.name}` });
        parts.push(file);
      }
      const staging = path.join(work, 'files');
      await fsp.rm(staging, { recursive: true, force: true });
      await fsp.mkdir(staging, { recursive: true });
      this.emit('server', 'Unpacking the server update…');
      await this.tar(['-x', '-f', '-', '-C', staging], async stdin => {
        const joined = Readable.from((async function* () { for (const f of parts) for await (const chunk of fs.createReadStream(f)) yield chunk; })());
        await pipeline(joined, zlib.createZstdDecompress(), stdin);
      });
      // Safety net: characters and accounts are saved before anything is replaced. If this fails, nothing is changed.
      const safety = await this.backupInternal(root, 'before-update').catch(error => { throw new Error(`Update cancelled, the safety backup failed: ${error.message}`); });
      this.emit('server', 'Stopping the server…');
      await this.manage(root, 'stop-all');
      this.emit('server', 'Replacing server files…');
      for (const f of manifest.files) {
        if (f.policy !== 'replace' || path.isAbsolute(f.path) || f.path.split('/').includes('..')) continue;
        const target = path.join(root, f.path);
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.copyFile(path.join(staging, f.path), target);
      }
      await this.materializeModuleConfigs(root);
      this.emit('server', 'Applying database updates…');
      await this.manage(root, 'start-mysql');
      let applied = 0;
      try {
        const rows = await this.ledger(root);
        const stuck = [...rows].find(([, status]) => status === 'running' || status === 'failed');
        if (stuck) throw new Error(`Database update ${stuck[0]} failed earlier. Restore a backup (CoA Server Manager can) before updating again.`);
        // No history at all: the database already holds everything up to the installed version, so record the
        // updates as present instead of replaying them (same as the Manager's baseline).
        const fresh = rows.size === 0;
        const previous = fresh && installedVersion ? await this.migrationIds(installedVersion) : null;
        for (const m of manifest.migrations) {
          if (rows.get(`${m.db}/${m.id}`) === 'applied') continue;
          if (previous?.has(`${m.db}/${m.id}`)) { await this.recordMigration(root, m, 'applied', 1); continue; }
          const file = path.join(staging, '_migrations', m.db, `${m.id}.sql`);
          const digest = crypto.createHash('sha256').update(await fsp.readFile(file)).digest('hex');
          if (digest !== m.sha256.toLowerCase()) throw new Error(`Database update ${m.id} is damaged.`);
          await this.recordMigration(root, m, 'running');
          try { await this.sqlFile(root, SCHEMA[m.db], file); }
          catch (error) { await this.recordMigration(root, m, 'failed').catch(() => {}); throw new Error(`Database update ${m.id} failed: ${error.message}`); }
          await this.recordMigration(root, m, 'applied');
          applied++;
          this.emit('server', `Applying database updates… ${applied}`);
        }
      } finally { await this.manage(root, 'stop-all').catch(() => {}); }
      await fsp.rm(work, { recursive: true, force: true });
      this.emit('ready', `Server updated to ${release.tag_name}.`);
      return { version: release.tag_name, applied, backup: safety.name };
    });
  }

  async migrationIds(tag) {
    const release = await this.latestRelease(this.sources.server, tag);
    const response = await this.fetch(this.asset(release, 'manifest.json').browser_download_url);
    if (!response.ok) throw new Error(`Could not read the ${tag} database update list.`);
    return new Set((await response.json()).migrations.map(m => `${m.db}/${m.id}`));
  }

  // ---------- character backups ----------

  backupDir(root) { return path.join(root, 'Backups', 'launcher'); }

  async dbReady(root) { return this.sql(root, 'SELECT 1;').then(() => true, () => false); }

  // Runs `action` with the database up. If it was down, starts it and stops it again afterwards.
  async withDatabase(root, action) {
    if (await this.dbReady(root)) return action();
    this.emit('server', 'Starting the database…');
    await this.manage(root, 'start-mysql');
    try { return await action(); } finally { await this.manage(root, 'stop-all').catch(() => {}); }
  }

  // Dumps every character, account and guild (acore_characters + acore_auth) to a gzip file. Safe while the server runs.
  async backupInternal(root, reason = 'manual') {
    if (!/^[a-z-]{1,24}$/.test(reason)) throw new Error('Invalid backup label.');
    return this.withDatabase(root, async () => {
      const db = JSON.parse(await fsp.readFile(path.join(root, 'Settings/database.json'), 'utf8'));
      const repack = JSON.parse(await fsp.readFile(path.join(root, 'Settings/repack.json'), 'utf8'));
      const dir = this.backupDir(root);
      await fsp.mkdir(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
      const file = path.join(dir, `characters-${stamp}-${reason}.sql.gz`);
      this.emit('backup', 'Backing up characters and accounts…');
      await new Promise((resolve, reject) => {
        const dump = spawn(path.join(root, 'mysql/bin/mysqldump.exe'), ['-h127.0.0.1', `-P${repack.mysqlPort || 3306}`, '-uroot', '--single-transaction', '--routines', '--default-character-set=utf8mb4', '--databases', 'acore_characters', 'acore_auth'], { windowsHide: true, env: { ...process.env, MYSQL_PWD: db.rootPassword }, stdio: ['ignore', 'pipe', 'pipe'] });
        let err = '';
        dump.stderr.on('data', d => { err += d; });
        dump.on('error', reject);
        const out = fs.createWriteStream(file);
        const done = pipeline(dump.stdout, zlib.createGzip(), out);
        dump.on('close', async code => {
          try { await done; } catch (error) { return reject(error); }
          code === 0 ? resolve() : reject(new Error(`The database dump failed: ${err.trim().slice(0, 300)}`));
        });
      }).catch(async error => { await fsp.rm(file, { force: true }); throw error; });
      // A dump that does not end like a complete one (mysqldump writes this last line) is not a backup.
      const size = (await fsp.stat(file)).size;
      if (size < 200) { await fsp.rm(file, { force: true }); throw new Error('The backup came out empty. The database may not be set up yet.'); }
      await this.pruneBackups(dir);
      this.emit('ready', 'Backup saved.');
      return { file, name: path.basename(file), size };
    });
  }

  backup(root, reason = 'manual') { return this.exclusive(() => this.backupInternal(root, reason)); }

  // shortcut: keeps the newest 8 automatic backups, manual ones are never deleted; make this a setting if players want more.
  async pruneBackups(dir) {
    const auto = (await fsp.readdir(dir)).filter(n => /^characters-\d{8}-\d{6}-(before-update|before-restore|before-reset)\.sql\.gz$/.test(n)).sort().reverse();
    for (const old of auto.slice(8)) await fsp.rm(path.join(dir, old), { force: true });
  }

  async listBackups(root) {
    const dir = this.backupDir(root);
    const names = (await fsp.readdir(dir).catch(() => [])).filter(n => /^characters-\d{8}-\d{6}-[a-z-]+\.sql\.gz$/.test(n));
    const list = [];
    for (const name of names) {
      const stat = await fsp.stat(path.join(dir, name));
      const [, date, time, reason] = name.match(/^characters-(\d{8})-(\d{6})-([a-z-]+)\.sql\.gz$/);
      list.push({ name, size: stat.size, reason, when: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)} ${time.slice(0, 2)}:${time.slice(2, 4)}` });
    }
    return list.sort((a, b) => b.name.localeCompare(a.name));
  }

  // Replaces characters and accounts with a backup. The current state is saved first, the server is stopped first.
  async restore(root, name) {
    return this.exclusive(async () => {
      if (!/^characters-\d{8}-\d{6}-[a-z-]+\.sql\.gz$/.test(name)) throw new Error('Unknown backup.');
      const file = path.join(this.backupDir(root), name);
      if (!fs.existsSync(file)) throw new Error('That backup no longer exists.');
      this.emit('backup', 'Stopping the server…');
      await this.manage(root, 'stop-all').catch(() => {});
      const safety = await this.backupInternal(root, 'before-restore');
      return this.withDatabase(root, async () => {
        this.emit('backup', 'Restoring characters and accounts…');
        await this.sql(root, '', { stream: fs.createReadStream(file).pipe(zlib.createGunzip()) });
        this.emit('ready', 'Backup restored.');
        return { restored: name, safety: safety.name };
      });
    });
  }

  // ---------- game accounts, delete server ----------

  // AzerothCore SRP6: verifier = g^x mod N, x = SHA1(salt || SHA1(UPPER(user):UPPER(pass))), little-endian.
  srp6(username, password, salt = crypto.randomBytes(32)) {
    const N = BigInt('0x894B645E89E1535BBDAD5B8B290650530801B18EBFBF5E8FAB3C82872A3E9BB7');
    const sha = (...parts) => crypto.createHash('sha1').update(Buffer.concat(parts)).digest();
    const inner = sha(Buffer.from(`${username.toUpperCase()}:${password.toUpperCase()}`, 'utf8'));
    const x = BigInt('0x' + Buffer.from(sha(salt, inner)).reverse().toString('hex'));
    let result = 1n, base = 7n, exp = x;
    for (; exp > 0n; exp >>= 1n, base = (base * base) % N) if (exp & 1n) result = (result * base) % N;
    const verifier = Buffer.from(result.toString(16).padStart(64, '0'), 'hex').reverse();
    return { salt, verifier };
  }

  async createAccount(root, { username, password, gm }) {
    const name = String(username || '').trim();
    if (!/^[A-Za-z0-9]{2,16}$/.test(name)) throw new Error('The account name needs 2 to 16 letters or digits.');
    if (typeof password !== 'string' || password.length < 4 || password.length > 16) throw new Error('The password needs 4 to 16 characters (the game limit).');
    return this.exclusive(() => this.withDatabase(root, async () => {
      const upper = name.toUpperCase();
      if ((await this.sql(root, `SELECT COUNT(*) FROM acore_auth.account WHERE username='${upper}';`)).trim() !== '0') throw new Error('That account name is already taken.');
      const { salt, verifier } = this.srp6(upper, password);
      await this.sql(root, `INSERT INTO acore_auth.account (username, salt, verifier, expansion, email, reg_mail) VALUES ('${upper}', 0x${salt.toString('hex')}, 0x${verifier.toString('hex')}, 2, '', '');`);
      if (gm) {
        const columns = (await this.sql(root, "SELECT column_name FROM information_schema.columns WHERE table_schema='acore_auth' AND table_name='account_access';")).split(/\s+/);
        const idCol = columns.includes('AccountID') ? 'AccountID' : 'id', levelCol = columns.includes('SecurityLevel') ? 'SecurityLevel' : 'gmlevel';
        await this.sql(root, `INSERT INTO acore_auth.account_access (${idCol}, ${levelCol}, RealmID) SELECT id, 3, -1 FROM acore_auth.account WHERE username='${upper}';`);
      }
      return { username: upper, gm: !!gm };
    }));
  }

  async listAccounts(root) {
    return this.withDatabase(root, async () => (await this.sql(root, "SELECT username FROM acore_auth.account WHERE username NOT LIKE 'RNDBOT%' ORDER BY id;")).split(/\r?\n/).map(s => s.trim()).filter(Boolean));
  }

  // Stops the server and deletes its whole folder (characters and the launcher's backups live inside it).
  async deleteServer(root) {
    return this.exclusive(async () => {
      if (!fs.existsSync(path.join(root, 'Scripts/manage.py')) || !fs.existsSync(path.join(root, 'Core'))) throw new Error('That folder does not look like a CoA server, so it was not deleted.');
      if (path.dirname(root) === root) throw new Error('Refusing to delete a drive root.');
      this.emit('server', 'Stopping the server…');
      await this.manage(root, 'stop-all').catch(() => {});
      this.emit('server', 'Deleting the server folder…');
      await fsp.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
      this.emit('ready', 'Server deleted.');
    });
  }

  // ---------- SquidBots dashboard ----------

  // Every active AiPlayerbot.* line of the server's playerbots.conf with the comment block above it.
  async botOptions(root) {
    const dir = path.join(root, 'Core/configs/modules');
    const text = await fsp.readFile(path.join(dir, 'playerbots.conf'), 'utf8').catch(() => fsp.readFile(path.join(dir, 'playerbots.conf.dist'), 'utf8').catch(() => ''));
    const options = []; let notes = [];
    for (const line of text.split(/\r?\n/)) {
      const kv = line.match(/^(AiPlayerbot\.[A-Za-z0-9_.]+)\s*=\s*(.*?)\s*$/);
      if (kv) { options.push({ key: kv[1], value: kv[2].replace(/^"(.*)"$/, '$1'), quoted: /^".*"$/.test(kv[2]), description: notes.join(' ').slice(0, 400) }); notes = []; }
      else if (/^#/.test(line)) notes.push(line.replace(/^#+\s?/, '').trim());
      else notes = [];
    }
    const custom = await this.readConf(root, 'coa_custom_races.conf', 'CoACustomRaces.BotsEnable');
    options.unshift({ key: 'CoACustomRaces.BotsEnable', value: custom ?? '0', quoted: false, description: 'Let bots spawn as the custom races. Off = bots only use the standard races.' });
    return options;
  }

  async setBotOption(root, key, value) {
    const known = (await this.botOptions(root)).find(o => o.key === key);
    if (!known) throw new Error('Unknown SquidBots option.');
    const text = String(value);
    if (/[\r\n"]/.test(text) || text.length > 300) throw new Error('That value is not allowed.');
    await this.setConf(root, key.startsWith('CoACustomRaces.') ? 'coa_custom_races.conf' : 'playerbots.conf', key, known.quoted ? `"${text}"` : text);
    return { key, value: text };
  }

  // Bots on the server's database, by race. null when the database is not running.
  async botStats(root) {
    if (!(await this.dbReady(root))) return null;
    const rows = await this.sql(root, "SELECT c.race, COUNT(*), SUM(c.online) FROM acore_characters.characters c JOIN acore_auth.account a ON a.id = c.account WHERE a.username LIKE 'RNDBOT%' GROUP BY c.race ORDER BY 2 DESC;").catch(() => '');
    const races = rows.split(/\r?\n/).filter(Boolean).map(r => r.split('\t')).map(([race, count, online]) => ({ race: Number(race), count: Number(count), online: Number(online) || 0 }));
    return { total: races.reduce((n, r) => n + r.count, 0), online: races.reduce((n, r) => n + r.online, 0), races };
  }

  // Deletes every random bot: the module purges bot accounts, guilds and arena teams on the next start when asked to,
  // so this switches that on, starts once, then always switches it back off (otherwise every start wipes the bots).
  async resetBots(root, realmAddress) {
    return this.exclusive(async () => {
      this.emit('server', 'Stopping the server…');
      await this.manage(root, 'stop-all').catch(() => {});
      await this.backupInternal(root, 'before-reset');
      if ((await this.readConf(root, 'coa_custom_races.conf', 'CoACustomRaces.Enable')) === '1' && (await this.readConf(root, 'playerbots.conf', 'AiPlayerbot.Enabled')) === '1') await this.setConf(root, 'coa_custom_races.conf', 'CoACustomRaces.BotsEnable', 1);
      const flags = ['AiPlayerbot.DeleteRandomBotAccounts', 'AiPlayerbot.DeleteRandomBotGuilds', 'AiPlayerbot.DeleteRandomBotArenaTeams'];
      try {
        for (const flag of flags) await this.setConf(root, 'playerbots.conf', flag, 1);
        this.emit('server', 'Deleting the bots (one start, this can take several minutes)…');
        await this.disableCompanions(root);
        await this.manage(root, 'start-all').catch(() => {});
      } finally {
        await this.manage(root, 'stop-all').catch(() => {});
        for (const flag of flags) await this.setConf(root, 'playerbots.conf', flag, 0).catch(() => {});
      }
      this.emit('ready', 'Bots deleted. Start the server to create new ones.');
      return true;
    });
  }

  // ---------- troubleshooting ----------

  async portBusy(port) {
    return new Promise(resolve => {
      const probe = require('node:net').createConnection({ port, host: '127.0.0.1' });
      probe.setTimeout(800);
      probe.on('connect', () => { probe.destroy(); resolve(true); });
      probe.on('timeout', () => { probe.destroy(); resolve(false); });
      probe.on('error', () => resolve(false));
    });
  }

  // Each check: { group, name, ok, detail, fix }. ok may be true, false or 'warn'.
  async troubleshoot({ serverPath, clientPath, realmlist, realmMode, modules, versions }) {
    const out = [];
    const add = (group, name, ok, detail, fix = '') => out.push({ group, name, ok, detail, fix });
    const exists = async p => !!(await fsp.stat(p).catch(() => null));
    const free = async dir => fsp.statfs(dir).then(s => s.bavail * s.bsize).catch(() => null);
    const gb = n => `${(n / 2 ** 30).toFixed(1)} GB`;

    // client
    if (!clientPath) add('Client', 'Game folder', false, 'No game folder chosen.', 'Press Locate game, or Download on the Home page.');
    else {
      add('Client', 'Game folder', await exists(clientPath), clientPath, 'Choose the folder again with Locate game.');
      add('Client', 'Ascension.exe', await exists(path.join(clientPath, 'Ascension.exe')), 'The original client program.', 'Press Download / Check now to repair the client.');
      const exe = await exists(path.join(clientPath, 'CoACustomRace.exe'));
      add('Client', 'CoACustomRace.exe', exe, exe ? 'The game this launcher starts.' : 'Missing, so Play cannot start.', 'Apply modules and tick CoA Custom Races.');
      const mpq = ['patch-T.MPQ', 'patch-ZG.MPQ'];
      const missing = [];
      for (const f of mpq) if (!(await exists(path.join(clientPath, 'Data', f)))) missing.push(f);
      add('Client', 'Custom Races files', modules?.races ? !missing.length : 'warn', modules?.races ? (missing.length ? `Missing: ${missing.join(', ')}` : 'Race archives present.') : 'Custom Races is not applied.', 'Apply modules, or Updates > Reinstall for Custom Races.');
      const dll = await exists(path.join(clientPath, 'EsteriaAppearance.dll'));
      add('Client', 'EsteriaAppearance.dll', modules?.races ? dll : 'warn', dll ? 'Present (needed by the Esteria races).' : 'Not found. Esteria races such as Mechagnome will look broken.', 'Updates > Reinstall for CoA Custom Races.');
      let wtf = '';
      for (const f of ['realmlist.wtf', 'Data/enUS/realmlist.wtf', 'Data/frFR/realmlist.wtf']) wtf ||= await fsp.readFile(path.join(clientPath, f), 'utf8').catch(() => '');
      const set = (wtf.match(/set realmlist\s+(\S+)/i) || [])[1];
      add('Client', 'Realmlist', !set ? 'warn' : set === realmlist, set ? `Game points to ${set}; launcher is set to ${realmlist} (${realmMode}).` : 'Not written yet; the launcher writes it when you press Play.', 'It is rewritten every time you press Play.');
      const space = await free(clientPath);
      if (space !== null) add('Client', 'Free disk space', space > 5 * 2 ** 30 ? true : 'warn', `${gb(space)} free on the game drive.`, 'Free some space before updating.');
    }

    // server
    if (!serverPath) add('Server', 'Server folder', 'warn', 'No server yet (fine if you only join a friend).', 'Create server or Locate on the Home page.');
    else {
      const parts = [['Scripts/manage.py', 'Server scripts'], ['Runtime/python/python.exe', 'Bundled Python'], ['Core/worldserver.exe', 'worldserver.exe'], ['Core/authserver.exe', 'authserver.exe'], ['mysql/bin/mysqld.exe', 'Database program'], ['Settings/database.json', 'Database login']];
      for (const [rel, label] of parts) add('Server', label, await exists(path.join(serverPath, rel)), rel, 'Repair by updating the server (Updates page) or recreating it.');
      const conf = async f => (await exists(path.join(serverPath, 'Core/configs/modules', f)));
      add('Server', 'Module settings', (await conf('playerbots.conf')) && (await conf('coa_custom_races.conf')), 'playerbots.conf and coa_custom_races.conf', 'Apply modules recreates them.');
      const space = await free(serverPath);
      if (space !== null) add('Server', 'Free disk space', space > 3 * 2 ** 30 ? true : 'warn', `${gb(space)} free on the server drive.`, 'Free some space before updating.');
      let ports = { mysqlPort: 3306, authPort: 3724, worldPort: 8085 };
      try { ports = { ...ports, ...JSON.parse(await fsp.readFile(path.join(serverPath, 'Settings/repack.json'), 'utf8')) }; } catch { /* checked above */ }
      const up = await this.dbReady(serverPath);
      add('Server', 'Database', up ? true : 'warn', up ? `Running on port ${ports.mysqlPort}.` : 'Not running (starts with the server).', 'Press Start.');
      if (up) {
        const rows = await this.sql(serverPath, "SELECT address FROM acore_auth.realmlist WHERE id=1;").catch(() => null);
        const addr = rows ? rows.trim() : null;
        add('Server', 'Realm address', addr === null ? 'warn' : addr === realmlist, addr === null ? 'Could not read the realm list.' : `Server hands out ${addr}; launcher is set to ${realmlist}.`, 'Realmlist > Save fixes it.');
        const chars = await this.sql(serverPath, 'SELECT COUNT(*) FROM acore_characters.characters;').catch(() => null);
        if (chars !== null) add('Server', 'Characters', true, `${chars.trim()} characters in the database.`);
      }
      for (const [port, label] of [[ports.authPort, 'Login port'], [ports.worldPort, 'World port']]) add('Server', label, 'warn', (await this.portBusy(port)) ? `${port} is in use (the server is running, or another program holds it).` : `${port} is free (server stopped).`, 'If Start fails, close the program using this port.');
    }

    // backups + network
    if (serverPath) {
      const list = await this.listBackups(serverPath);
      add('Safety', 'Character backup', list.length ? true : 'warn', list.length ? `Latest: ${list[0].when} (${list.length} saved).` : 'No backup yet.', 'Press Back up now. Updates make one automatically.');
    }
    const github = await this.fetch('https://api.github.com/rate_limit').then(r => r.ok, () => false);
    add('Network', 'GitHub (updates)', github, github ? 'Reachable.' : 'Cannot reach GitHub; updates and downloads will fail.', 'Check your internet connection or firewall.');
    const coaService = await this.fetch('https://launcher-api.coa-development.org/downloads/client/latest.json').then(r => r.ok, () => false);
    add('Network', 'CoA client service', coaService, coaService ? 'Reachable.' : 'Cannot reach the client download service.', 'Check your internet connection; try again later.');
    return out;
  }

  // ---------- races and bots ----------

  async races() {
    const response = await this.fetch(RACES_FILE);
    if (!response.ok) throw new Error(`The race list is unavailable (${response.status}).`);
    return [...STANDARD_RACES, ...parseRaces(await response.text())];
  }

  async readConf(root, file, key) {
    const dir = path.join(root, 'Core/configs/modules');
    const text = await fsp.readFile(path.join(dir, file), 'utf8').catch(() => fsp.readFile(path.join(dir, file + '.dist'), 'utf8').catch(() => ''));
    const match = text.match(new RegExp(`^\\s*${key.replace(/\./g, '\\.')}\\s*=\\s*"?([^"\\r\\n]*)"?`, 'm'));
    return match ? match[1].trim() : null;
  }

  async botRaces(root) {
    const ids = value => (value || '').split(/[,\s]+/).filter(Boolean).map(Number).filter(Number.isInteger);
    return { excluded: ids(await this.readConf(root, 'playerbots.conf', 'AiPlayerbot.ExcludedBotRaces')), crashing: ids(await this.readConf(root, 'playerbots.conf', 'AiPlayerbot.CrashingBotRaces')).filter(id => !SABERON_IDS.includes(id)) };
  }

  // allowed = race ids bots may spawn as; every other known race is excluded.
  async setBotRaces(root, allowed, known) {
    const allow = new Set(allowed);
    if (!allow.size) throw new Error('Pick at least one race for the bots.');
    // Test Race (65) is not a real race and is never offered to bots.
    const excluded = [...new Set([...known.filter(id => !allow.has(id)), 65])];
    const crash = (await this.readConf(root, 'playerbots.conf', 'AiPlayerbot.CrashingBotRaces') || '').split(/[,\s]+/).filter(id => id && !SABERON_IDS.includes(Number(id)));
    await this.setConf(root, 'playerbots.conf', 'AiPlayerbot.CrashingBotRaces', `"${crash.join(',')}"`);
    await this.setConf(root, 'playerbots.conf', 'AiPlayerbot.ExcludedBotRaces', `"${excluded.join(',')}"`);
    await this.setConf(root, 'coa_custom_races.conf', 'CoACustomRaces.BotsEnable', [...allow].some(id => id > 11) ? 1 : 0);
    return { excluded };
  }
}

// shortcut: Saberon id is hard-coded (moved 84->97 for Alliance rep); read it from RACES.md if it moves again.
const SABERON_IDS = [97];

module.exports = { CoaCustom, networkAddresses, hostnameOk, parseRaces, SOURCES };
