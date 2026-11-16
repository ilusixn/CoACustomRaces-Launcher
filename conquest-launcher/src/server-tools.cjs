// CoA Custom Races addition to Conquest Launcher (originally developed by Duff (Duff-SPP)); GPL-3.0-only.
// Server page back end: where the server lives (check a folder, move the server), its ports and state, and the popular
// world settings. Moving never touches the source folder: it is copied, checked, and only then does the launcher switch.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const GB = 2 ** 30;
const MAX_PATH_BUDGET = 240; // Windows stops at 260; leave room for the tools
const SKIP_COPY = new Set(['.state']); // process records of the old location, rebuilt by the server's own scripts
// Text files that may hold the old folder; everything else (databases, logs, game data) is never rewritten.
const TEXT_EXT = new Set(['.conf', '.ini', '.json', '.bat', '.cmd', '.txt', '.template', '.dist', '.cfg', '.yml', '.yaml', '.sh', '.ps1']);
const SKIP_REWRITE = ['mysql/data', 'mysql/logs', 'Data', 'Data.corfirean', 'Runtime', 'Core/Logs', 'Backups', 'BugReport/reports', 'BugReport/Logs', 'Licenses', 'Extras'];

// ---- popular world settings: [key, group, title, type, min, max]. Descriptions come from the server's own worldserver.conf comments. ----
const WORLD_GROUPS = {
  xp: 'Experience', drops: 'Loot and drops', rep: 'Reputation, honor and skills', travel: 'Travel and starting bonuses', faction: 'Cross-faction play', misc: 'Other'
};
const rate = (key, group, title, max = 100) => [key, group, title, 'float', 0, max];
const WORLD_OPTIONS = [
  rate('Rate.XP.Kill', 'xp', 'XP from kills'), rate('Rate.XP.Quest', 'xp', 'XP from quests'), rate('Rate.XP.Explore', 'xp', 'XP from exploring'), rate('Rate.XP.Pet', 'xp', 'Pet XP'),
  rate('Rate.Rest.InGame', 'xp', 'Rested XP while playing'), rate('Rate.Rest.Offline.InTavernOrCity', 'xp', 'Rested XP offline in a city or inn'),
  rate('Rate.Drop.Item.Poor', 'drops', 'Poor (grey) item drops'), rate('Rate.Drop.Item.Normal', 'drops', 'Common (white) item drops'), rate('Rate.Drop.Item.Uncommon', 'drops', 'Uncommon (green) item drops'),
  rate('Rate.Drop.Item.Rare', 'drops', 'Rare (blue) item drops'), rate('Rate.Drop.Item.Epic', 'drops', 'Epic (purple) item drops'), rate('Rate.Drop.Item.Legendary', 'drops', 'Legendary item drops'),
  rate('Rate.Drop.Money', 'drops', 'Gold from monsters'), rate('Rate.RepairCost', 'drops', 'Repair cost'),
  rate('Rate.Reputation.Gain', 'rep', 'Reputation gains'), rate('Rate.Honor', 'rep', 'Honor gains'), rate('Rate.ArenaPoints', 'rep', 'Arena points'),
  rate('Rate.Skill.Discovery', 'rep', 'Skill discovery chance'), rate('Rate.Talent', 'rep', 'Talent points per level'),
  rate('SkillGain.Crafting', 'rep', 'Crafting skill gain', 20), rate('SkillGain.Gathering', 'rep', 'Gathering skill gain', 20), rate('SkillGain.Weapon', 'rep', 'Weapon skill gain', 20), rate('SkillGain.Defense', 'rep', 'Defense skill gain', 20),
  ['AllFlightPaths', 'travel', 'All flight paths known from the start', 'bool'], ['InstantFlightPaths', 'travel', 'Instant flights (no waiting on the flight path)', 'bool'],
  ['PlayerStart.AllReputation', 'travel', 'Start with maximum reputation', 'bool'], ['PlayerStart.MapsExplored', 'travel', 'Start with every map explored', 'bool'],
  ['StartPlayerMoney', 'travel', 'Starting money (copper: 10000 = 1 gold)', 'int', 0, 2147483647],
  ['AllowTwoSide.Accounts', 'faction', 'Both factions on one account', 'bool'], ['AllowTwoSide.Interaction.Chat', 'faction', 'Cross-faction chat', 'bool'],
  ['AllowTwoSide.Interaction.Channel', 'faction', 'Cross-faction chat channels', 'bool'], ['AllowTwoSide.Interaction.Group', 'faction', 'Cross-faction groups', 'bool'],
  ['AllowTwoSide.Interaction.Guild', 'faction', 'Cross-faction guilds', 'bool'], ['AllowTwoSide.Interaction.Auction', 'faction', 'Shared auction house', 'bool'],
  ['AllowTwoSide.Interaction.Calendar', 'faction', 'Cross-faction calendar', 'bool'], ['AllowTwoSide.Interaction.Arena', 'faction', 'Cross-faction arena teams', 'bool'],
  ['Death.SicknessLevel', 'misc', 'Resurrection sickness up to level (-10 = never)', 'int', -10, 80], ['Instance.IgnoreLevel', 'misc', 'Enter instances at any level', 'bool'],
  ['MaxPrimaryTradeSkill', 'misc', 'Primary professions per character', 'int', 0, 11], ['Quests.IgnoreRaid', 'misc', 'Raid quests can be done in a normal group', 'bool']
].map(([key, group, title, type, min, max]) => ({ key, group, title, type, min: min ?? null, max: max ?? null }));
const WORLD_BY_KEY = new Map(WORLD_OPTIONS.map(o => [o.key, o]));

const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const keyLine = key => new RegExp(`^([ \\t]*${escapeRegex(key)}[ \\t]*=[ \\t]*)([^\\r\\n#]*?)([ \\t]*(?:#[^\\r\\n]*)?)(\\r?)$`, 'm');

// The "Description:" part of the comment block above a setting, flattened to one paragraph.
function describe(lines, index) {
  let end = index - 1; // settings of one block share its comment: skip blank lines and the sibling settings above
  while (end >= 0 && !lines[end].trim().startsWith('#')) end--;
  let start = end;
  while (start >= 0 && lines[start].trim().startsWith('#')) start--;
  const block = lines.slice(start + 1, end + 1).map(l => l.replace(/^\s*#\s?/, '').replace(/\r$/, ''));
  const at = block.findIndex(l => /^\s*Description:/.test(l));
  if (at < 0) return block.filter(l => l.trim() && !/^\s*[\w.]+\s*$/.test(l)).join(' ').replace(/\s+/g, ' ').trim().slice(0, 400);
  const out = [block[at].replace(/^\s*Description:\s*/, '')];
  for (const line of block.slice(at + 1)) { if (/^\s*[A-Z][A-Za-z ]*:/.test(line)) break; out.push(line); }
  return out.join(' ').replace(/\s+/g, ' ').trim().slice(0, 400);
}
function readValue(text, key) { const m = keyLine(key).exec(text); return m ? m[2].trim().replace(/^"(.*)"$/, '$1') : null; }

function samePath(a, b) { return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase(); }
function inside(parent, child) { const rel = path.relative(path.resolve(parent), path.resolve(child)); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); }

class ServerTools {
  constructor({ coa, notify = () => {} }) { this.coa = coa; this.notify = notify; }
  emit(message, extra = {}) { this.notify({ phase: 'server', message, ...extra }); }

  // ---- facts ----
  async status(root) {
    const python = path.join(root, 'Runtime/python/python.exe');
    return new Promise(resolve => {
      const child = spawn(python, [path.join(root, 'Scripts/manage.py'), 'status-json'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      let out = ''; child.stdout.on('data', d => { out += d; });
      child.on('error', () => resolve(null));
      child.on('close', () => { try { resolve(JSON.parse(out.trim().split(/\r?\n/).pop())); } catch { resolve(null); } });
    });
  }
  async ports(root) {
    const defaults = { authPort: 3724, worldPort: 8085, mysqlPort: 3306, raPort: 3443 };
    try { return { ...defaults, ...JSON.parse(await fsp.readFile(path.join(root, 'Settings/repack.json'), 'utf8')) }; } catch { return defaults; }
  }
  async drive(root) {
    const stat = await fsp.statfs(path.parse(path.resolve(root)).root).catch(() => null);
    return { root: path.parse(path.resolve(root)).root, free: stat ? stat.bavail * stat.bsize : 0, total: stat ? stat.blocks * stat.bsize : 0 };
  }
  async info(root, { versionHint = '', startedAt = 0 } = {}) {
    const status = await this.status(root);
    const ports = await this.ports(root);
    let source = {}; try { source = JSON.parse(await fsp.readFile(path.join(root, 'Settings/install-source.json'), 'utf8')); } catch { /* foreign servers have none */ }
    let realm = null;
    if (status?.mysql) realm = (await this.coa.sql(root, 'SELECT name, address FROM acore_auth.realmlist WHERE id=1;').catch(() => '')).trim().split('\t');
    return {
      path: root, drive: await this.drive(root), version: versionHint || source.version || '', own: fs.existsSync(path.join(root, 'Settings/own-server.json')), foreign: this.coa.foreignServer(root),
      ports: { auth: ports.authPort, world: ports.worldPort, mysql: ports.mysqlPort, ra: ports.raPort }, running: status ? !!(status.world || status.auth || status.mysql) : null, status,
      realm: realm && realm.length === 2 ? { name: realm[0], address: realm[1] } : null, startedAt: status && status.world ? startedAt : 0
    };
  }

  // Sizes and the longest relative path, with links refused (a link could lead outside the server).
  async scan(root, { skip = () => false } = {}) {
    const files = []; const dirs = []; let bytes = 0; let longest = 0;
    const walk = async rel => {
      for (const item of await fsp.readdir(path.join(root, rel), { withFileTypes: true })) {
        const child = rel ? `${rel}/${item.name}` : item.name;
        if (skip(child)) continue;
        if (item.isSymbolicLink()) throw new Error(`The server folder contains a link (${child}); moving it would be unsafe.`);
        longest = Math.max(longest, child.length);
        if (item.isDirectory()) { dirs.push(child); await walk(child); }
        else if (item.isFile()) { const size = (await fsp.stat(path.join(root, child))).size; files.push({ rel: child, size }); bytes += size; }
        else throw new Error(`Unsupported file in the server folder: ${child}`);
      }
    };
    await walk('');
    return { files, dirs, bytes, longest };
  }
  async folderSize(root) { const { bytes, files } = await this.scan(root); return { bytes, files: files.length }; }

  // ---- is this folder a sane place for a server? (also used by Create server) ----
  async checkFolder(dest, { source = '', bytes = 0, longest = 0 } = {}) {
    const problems = []; const warnings = [];
    if (typeof dest !== 'string' || !path.isAbsolute(dest)) return { problems: ['Choose a full folder path.'], warnings, free: 0 };
    dest = path.resolve(dest);
    const root = path.parse(dest).root;
    if (dest.startsWith('\\\\')) problems.push('Network folders (\\\\server\\share) cannot host a server: the database needs a local disk.');
    if (dest === root) problems.push('Choose a folder on the drive, not the drive itself (for example D:\\CoA Server).');
    let ancestor = dest;
    while (!(await fsp.stat(ancestor).catch(() => null)) && path.dirname(ancestor) !== ancestor) ancestor = path.dirname(ancestor);
    const real = await fsp.realpath(ancestor).catch(() => ancestor);
    if (real.startsWith('\\\\')) problems.push('That drive is a network drive. The server database needs a local disk.');
    const sync = [process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial].filter(Boolean);
    if (dest.split(path.sep).some(p => /^OneDrive/i.test(p)) || sync.some(p => inside(p, dest) || inside(p, real))) problems.push('OneDrive folders are synced while the server writes to them, which can corrupt the database. Choose a folder outside OneDrive.');
    else if (dest.split(path.sep).some(p => /^(dropbox|google ?drive|icloud.*|mega|pcloud.*)$/i.test(p))) warnings.push('This looks like a cloud-synced folder. Syncing while the server runs can corrupt the database; a plain folder is safer.');
    if (/[^\x20-\x7e]/.test(dest)) warnings.push('The path has accents or special characters. It usually works, but a plain ASCII path is safer for the database.');
    if (dest.length > 120) problems.push(`That path is too long (${dest.length} characters). Choose a shorter one, for example D:\\CoA Server.`);
    else if (longest && dest.length + longest + 1 > MAX_PATH_BUDGET) problems.push('The server has deep folders, so that path would pass the Windows length limit. Choose a shorter path.');
    if (source) {
      if (samePath(source, dest)) problems.push('That is the folder the server is already in.');
      else if (inside(source, dest)) problems.push('The new folder cannot be inside the current server folder.');
      else if (inside(dest, source)) problems.push('The new folder cannot contain the current server folder.');
    }
    const existing = await fsp.readdir(dest).catch(error => error.code === 'ENOENT' ? [] : null);
    if (existing === null) problems.push('That folder cannot be read.');
    else if (existing.length) problems.push('Choose an empty folder (or one that does not exist yet).');
    const stat = await fsp.statfs(ancestor).catch(() => null);
    const free = stat ? stat.bavail * stat.bsize : 0;
    if (bytes) {
      const needed = bytes + Math.max(GB, Math.round(bytes * 0.05));
      if (free < needed) problems.push(`Not enough free space there: about ${Math.ceil(needed / GB)} GB needed, ${(free / GB).toFixed(1)} GB free.`);
    }
    return { problems, warnings, free };
  }

  // ---- move ----
  async copyFiles(from, to, scan) {
    for (const dir of scan.dirs) await fsp.mkdir(path.join(to, dir), { recursive: true });
    let done = 0; let last = 0; const started = Date.now();
    const tick = force => {
      if (!force && Date.now() - last < 500) return; last = Date.now();
      const speed = done / Math.max(1, (last - started) / 1000);
      this.emit('Copying the server…', { done, total: scan.bytes, speed, eta: speed > 0 && last - started > 2000 ? Math.round((scan.bytes - done) / speed) : 0 });
    };
    const queue = [...scan.files];
    const worker = async () => {
      for (let file = queue.shift(); file; file = queue.shift()) {
        const source = path.join(from, ...file.rel.split('/')); const target = path.join(to, ...file.rel.split('/'));
        if (file.size > 32 * 2 ** 20) {
          await pipeline(fs.createReadStream(source), new Transform({ transform(chunk, _e, next) { done += chunk.length; tick(false); next(null, chunk); } }), fs.createWriteStream(target, { flags: 'wx' }));
        } else { await fsp.copyFile(source, target, fs.constants.COPYFILE_EXCL); done += file.size; tick(false); }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    tick(true);
  }
  async sameFiles(to, scan) {
    for (const file of scan.files) {
      const stat = await fsp.stat(path.join(to, ...file.rel.split('/'))).catch(() => null);
      if (!stat || stat.size !== file.size) throw new Error(`The copy of ${file.rel} does not match the original.`);
    }
  }
  // Rewrites the old folder inside the small text files of the NEW copy (the old folder is never touched).
  async rewritePaths(oldRoot, newRoot) {
    const forms = [oldRoot, oldRoot.replace(/\\/g, '/'), oldRoot.replace(/\\/g, '\\\\')];
    const to = [newRoot, newRoot.replace(/\\/g, '/'), newRoot.replace(/\\/g, '\\\\')];
    const changed = [];
    const walk = async rel => {
      for (const item of await fsp.readdir(path.join(newRoot, rel), { withFileTypes: true })) {
        const child = rel ? `${rel}/${item.name}` : item.name;
        if (SKIP_REWRITE.some(s => child === s || child.startsWith(s + '/'))) continue;
        if (item.isDirectory()) { await walk(child); continue; }
        if (!item.isFile() || !TEXT_EXT.has(path.extname(item.name).toLowerCase())) continue;
        const file = path.join(newRoot, ...child.split('/'));
        if ((await fsp.stat(file)).size > 2 * 2 ** 20) continue;
        let text = await fsp.readFile(file, 'utf8'); const before = text;
        forms.forEach((form, i) => { text = text.replace(new RegExp(escapeRegex(form), 'gi'), () => to[i]); });
        if (text !== before) { await fsp.writeFile(file, text); changed.push(child); }
      }
    };
    await walk('');
    return changed;
  }

  // Copies the server to `dest`, checks the copy, and returns the new location. The old folder is left exactly as it was.
  // `beforeStop` lets the caller stop anything that depends on the server (dashboard).
  async move(root, dest, { beforeStop = async () => {} } = {}) {
    return this.coa.exclusive(async () => {
      if (typeof dest !== 'string' || !path.isAbsolute(dest)) throw new Error('Choose a full folder path.'); // never resolve a relative path against the launcher's own folder
      dest = path.resolve(dest);
      if (!fs.existsSync(path.join(root, 'Scripts/manage.py'))) throw new Error('The current folder is not a CoA server.');
      this.emit('Looking at the server…');
      const skip = rel => SKIP_COPY.has(rel);
      const first = await this.scan(root, { skip });
      const check = await this.checkFolder(dest, { source: root, bytes: first.bytes, longest: first.longest });
      if (check.problems.length) throw new Error(check.problems.join(' '));
      await beforeStop();
      this.emit('Stopping the server…');
      await this.coa.manage(root, 'stop-all').catch(() => {});
      const after = await this.status(root);
      if (!after || after.mysql || after.auth || after.world) throw new Error('The server could not be stopped completely, so it was not moved.');
      // Characters first: a backup stays safe inside the server folder (it is copied too) and a count to compare with.
      this.emit('Backing up characters…');
      const counts = async folder => (await this.coa.sql(folder, 'SELECT (SELECT COUNT(*) FROM acore_characters.characters), (SELECT COUNT(*) FROM acore_auth.account);')).trim();
      let before = ''; let backup;
      await this.coa.withDatabase(root, async () => { before = await counts(root); backup = await this.coa.backupInternal(root, 'before-move'); });
      // Starting the database for the backup changes its files, so the list to copy is taken now, with everything stopped.
      const scan = await this.scan(root, { skip });
      const existed = fs.existsSync(dest);
      await fsp.mkdir(dest, { recursive: true });
      try {
        await this.copyFiles(root, dest, scan);
        this.emit('Checking the copy…');
        await this.sameFiles(dest, scan);
        const rewritten = await this.rewritePaths(root, dest);
        this.emit('Starting the copy to check the characters…');
        let seen = '';
        try { await this.coa.manage(dest, 'start-mysql'); seen = await this.coa.sql(dest, 'SELECT (SELECT COUNT(*) FROM acore_characters.characters), (SELECT COUNT(*) FROM acore_auth.account);'); }
        finally { await this.coa.manage(dest, 'stop-all').catch(() => {}); }
        if (seen.trim() !== before) throw new Error(`The copy holds different characters than the original (${seen.trim()} against ${before}), so it was not used.`);
        const [characters, accounts] = before.split(/\s+/).map(Number);
        this.emit('The server was copied and checked.');
        return { path: dest, characters, accounts, files: scan.files.length, bytes: scan.bytes, rewritten, backup: backup.name };
      } catch (error) {
        // Only the copy is removed; the original folder is untouched and stays the active server.
        await fsp.rm(dest, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }).catch(() => {});
        if (existed) await fsp.mkdir(dest, { recursive: true }).catch(() => {});
        throw error;
      }
    });
  }

  // The previous folder after a move: only when it is a server, not the active one, and stopped.
  async deleteOld(oldRoot, activeRoot) {
    return this.coa.exclusive(async () => {
      if (!oldRoot || samePath(oldRoot, activeRoot) || inside(oldRoot, activeRoot) || inside(activeRoot, oldRoot)) throw new Error('That folder is the active server or overlaps it, so it was not deleted.');
      if (!fs.existsSync(path.join(oldRoot, 'Scripts/manage.py')) || !fs.existsSync(path.join(oldRoot, 'Core'))) throw new Error('That folder no longer looks like a CoA server, so it was not deleted.');
      if (path.dirname(oldRoot) === oldRoot) throw new Error('Refusing to delete a drive root.');
      const status = await this.status(oldRoot);
      if (status && (status.mysql || status.auth || status.world)) throw new Error('The old server is running. Stop it first.');
      this.emit('Deleting the old copy…');
      await fsp.rm(oldRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    });
  }

  // ---- ports (server stopped only; the login port stays because the game connects to it) ----
  async setPorts(root, values) {
    const status = await this.status(root);
    if (!status || status.mysql || status.auth || status.world) throw new Error('Stop the server before changing its ports.');
    const file = path.join(root, 'Settings/repack.json');
    const current = JSON.parse(await fsp.readFile(file, 'utf8'));
    const next = { ...current };
    for (const key of ['worldPort', 'mysqlPort', 'raPort']) {
      if (values[key] === undefined) continue;
      const port = Number(values[key]);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('A port is a number from 1024 to 65535.');
      next[key] = port;
    }
    const all = [next.authPort, next.worldPort, next.mysqlPort, next.raPort];
    if (new Set(all).size !== all.length) throw new Error('Each port must be different.');
    for (const key of ['worldPort', 'mysqlPort', 'raPort']) if (next[key] !== current[key] && await this.coa.portBusy(next[key])) throw new Error(`Port ${next[key]} is already used by another program.`);
    const tmp = file + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(next, null, 2)); await fsp.rename(tmp, file);
    return this.ports(root);
  }

  // ---- world settings (the template is the source: worldserver.conf is regenerated from it at every start) ----
  templateFile(root) { return path.join(root, 'Settings/worldserver.conf.template'); }
  async worldOptions(root) {
    let text; try { text = await fsp.readFile(this.templateFile(root), 'utf8'); } catch { throw new Error('This server has no Settings/worldserver.conf.template, so its world settings cannot be edited here.'); }
    const lines = text.split('\n');
    // "Default" is what the server shipped with: the copy kept before the first edit, else the file as it is; the .dist stays the reference for the rest.
    const shipped = await fsp.readFile(this.templateFile(root) + '.launcher-original', 'utf8').catch(() => text);
    const dist = await fsp.readFile(path.join(root, 'Core/configs/worldserver.conf.dist'), 'utf8').catch(() => '');
    const rows = [];
    for (const option of WORLD_OPTIONS) {
      const value = readValue(text, option.key);
      if (value === null) continue;
      const index = lines.findIndex(l => keyLine(option.key).test(l));
      const fallback = readValue(shipped, option.key) ?? readValue(dist, option.key);
      rows.push({ ...option, group: option.group, groupTitle: WORLD_GROUPS[option.group], value: Number(value), default: fallback === null ? Number(value) : Number(fallback), description: describe(lines, index) });
    }
    return { groups: WORLD_GROUPS, options: rows, reference: fs.existsSync(path.join(root, 'Core/configs/worldserver.conf.dist')) };
  }
  async setWorldOption(root, key, value) {
    const option = WORLD_BY_KEY.get(key);
    if (!option) throw new Error('That setting cannot be changed here.');
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error('A number is needed.');
    if (option.type === 'bool' && number !== 0 && number !== 1) throw new Error('This setting is on (1) or off (0).');
    if (option.type === 'int' && !Number.isInteger(number)) throw new Error('This setting needs a whole number.');
    if (option.min !== null && number < option.min) throw new Error(`The lowest value is ${option.min}.`);
    if (option.max !== null && number > option.max) throw new Error(`The highest value is ${option.max}.`);
    const file = this.templateFile(root);
    const text = await fsp.readFile(file, 'utf8');
    if (!keyLine(key).test(text)) throw new Error('That setting is not in this server\'s configuration.');
    const backup = file + '.launcher-original';
    if (!fs.existsSync(backup)) await fsp.copyFile(file, backup);
    const out = text.replace(keyLine(key), (_all, head, _old, tail, eol) => `${head}${number}${tail}${eol}`);
    const tmp = file + '.tmp'; await fsp.writeFile(tmp, out); await fsp.rename(tmp, file);
    return this.worldOptions(root);
  }
}

module.exports = { ServerTools, WORLD_OPTIONS, describe, keyLine, readValue };
