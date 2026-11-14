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

  // Runs SQL with the server's own mysql.exe; returns tab-separated rows. With `file`, the file is fed on stdin.
  async sql(root, statement, { schema = '', file = '' } = {}) {
    const db = JSON.parse(await fsp.readFile(path.join(root, 'Settings/database.json'), 'utf8'));
    const repack = JSON.parse(await fsp.readFile(path.join(root, 'Settings/repack.json'), 'utf8'));
    const mysql = path.join(root, 'mysql/bin/mysql.exe');
    const args = ['-h127.0.0.1', `-P${repack.mysqlPort || 3306}`, '-uroot', '-N', '-B', '--default-character-set=utf8mb4', ...(schema ? [schema] : []), ...(file ? [] : ['-e', statement])];
    return new Promise((resolve, reject) => {
      // MYSQL_PWD keeps the password off the process command line.
      const child = spawn(mysql, args, { windowsHide: true, env: { ...process.env, MYSQL_PWD: db.rootPassword }, stdio: [file ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
      let out = ''; let err = '';
      child.stdout.on('data', d => { out += d; });
      child.stderr.on('data', d => { err += d; });
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve(out) : reject(new Error(`Database error: ${err.trim().slice(0, 300)}`)));
      if (file) fs.createReadStream(file).on('error', reject).pipe(child.stdin);
    });
  }

  sqlFile(root, schema, file) { return this.sql(root, '', { schema, file }); }

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

  // Installs (or updates, with `only`) the chosen modules' files and sets the server switches. Returns installed versions.
  async applyModules({ serverPath, clientPath, squid, devMenu, races, only = null }) {
    return this.exclusive(async () => {
      const versions = {};
      const want = key => only ? only === key : { squid, devMenu, races }[key];
      const addons = clientPath ? path.join(clientPath, 'Interface/AddOns') : '';
      if (serverPath && !only) {
        await this.setConf(serverPath, 'playerbots.conf', 'AiPlayerbot.Enabled', squid ? 1 : 0);
        await this.setConf(serverPath, 'coa_custom_races.conf', 'CoACustomRaces.Enable', races ? 1 : 0);
      }
      if (want('squid') && addons) versions.squid = await this.installAddon(SOURCES.squidAddon, /\.zip$/i, 'SquidBots addon', addons);
      if (want('devMenu') && addons) versions.devMenu = await this.installAddon(SOURCES.devMenu, /addon.*\.zip$/i, 'Dev Menu addon', addons);
      if (want('races') && clientPath) versions.races = await this.installRaces(clientPath);
      const notes = [];
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
    const [server, squid, devMenu, races] = await Promise.all([tag(SOURCES.server), tag(SOURCES.squidAddon), tag(SOURCES.devMenu), tag(SOURCES.races)]);
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
      const release = await this.latestRelease(SOURCES.server);
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
      return { version: release.tag_name, applied };
    });
  }

  async migrationIds(tag) {
    const release = await this.latestRelease(SOURCES.server, tag);
    const response = await this.fetch(this.asset(release, 'manifest.json').browser_download_url);
    if (!response.ok) throw new Error(`Could not read the ${tag} database update list.`);
    return new Set((await response.json()).migrations.map(m => `${m.db}/${m.id}`));
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
    return { excluded: ids(await this.readConf(root, 'playerbots.conf', 'AiPlayerbot.ExcludedBotRaces')), crashing: ids(await this.readConf(root, 'playerbots.conf', 'AiPlayerbot.CrashingBotRaces')) };
  }

  // allowed = race ids bots may spawn as; every other known race is excluded.
  async setBotRaces(root, allowed, known) {
    const allow = new Set(allowed);
    if (!allow.size) throw new Error('Pick at least one race for the bots.');
    // Test Race (65) is not a real race and is never offered to bots.
    const excluded = [...new Set([...known.filter(id => !allow.has(id)), 65])];
    await this.setConf(root, 'playerbots.conf', 'AiPlayerbot.ExcludedBotRaces', `"${excluded.join(',')}"`);
    await this.setConf(root, 'coa_custom_races.conf', 'CoACustomRaces.BotsEnable', [...allow].some(id => id > 11) ? 1 : 0);
    return { excluded };
  }
}

module.exports = { CoaCustom, networkAddresses, hostnameOk, parseRaces, SOURCES };
