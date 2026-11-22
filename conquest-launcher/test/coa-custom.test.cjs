// CoA Custom Races additions: config switches, address checks and saved settings.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { CoaCustom, hostnameOk, networkAddresses, isTailscaleAddress, hostsHere, parseRaces } = require('../src/coa-custom.cjs');
const { sanitize } = require('../src/settings.cjs');

test('module switches replace an existing key, add a missing one and create the file from .dist', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coa-custom-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'Core/configs/modules');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'playerbots.conf.dist'), '[worldserver]\nAiPlayerbot.Enabled = 1\nAiPlayerbot.Other = 5\n');
  await fs.writeFile(path.join(dir, 'coa_custom_races.conf'), '[worldserver]\n');
  const coa = new CoaCustom({ fetchImpl: null, notify: () => {} });
  await coa.setConf(root, 'playerbots.conf', 'AiPlayerbot.Enabled', 0);
  await coa.setConf(root, 'coa_custom_races.conf', 'CoACustomRaces.Enable', 1);
  assert.equal(await fs.readFile(path.join(dir, 'playerbots.conf'), 'utf8'), '[worldserver]\nAiPlayerbot.Enabled = 0\nAiPlayerbot.Other = 5\n');
  assert.match(await fs.readFile(path.join(dir, 'coa_custom_races.conf'), 'utf8'), /^CoACustomRaces\.Enable = 1$/m);
  await assert.rejects(coa.setConf(root, 'missing.conf', 'X', 1), /missing from the server/);
});

test('bot races keep at least one race and always exclude Test Race', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coa-bots-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'Core/configs/modules');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'playerbots.conf'), 'AiPlayerbot.ExcludedBotRaces = "65"\nAiPlayerbot.CrashingBotRaces = "72,77"\n');
  await fs.writeFile(path.join(dir, 'coa_custom_races.conf'), '');
  const coa = new CoaCustom({ fetchImpl: null, notify: () => {} });
  assert.deepEqual(await coa.botRaces(root), { serverIds: null, excluded: [65], crashing: [72, 77] });
  await coa.setBotRaces(root, [1, 13], [1, 2, 13, 14]);
  assert.deepEqual((await coa.botRaces(root)).excluded, [2, 14, 65]);
  assert.match(await fs.readFile(path.join(dir, 'coa_custom_races.conf'), 'utf8'), /CoACustomRaces\.BotsEnable = 1/);
  await assert.rejects(coa.setBotRaces(root, [], [1]), /at least one race/);
});

test('race list parses single ids and Alliance/Horde pairs', () => {
  const rows = parseRaces('| Id | Race | Side | Credit | Notes |\n|---|---|---|---|---|\n| 20/29 | Pandaren | Both | Eunoia |  |\n| 105 | Gilgoblin | Horde | ilusixn | new |\n');
  assert.deepEqual(rows.map(r => [r.ids, r.name]), [[[20, 29], 'Pandaren'], [[105], 'Gilgoblin']]);
});

test('backups list newest first, label their reason and keep only the newest 8 automatic ones', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coa-bk-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const coa = new CoaCustom({ fetchImpl: null, notify: () => {} });
  const dir = coa.backupDir(root);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'characters-20260101-100000-manual.sql.gz'), 'x');
  for (let i = 1; i <= 10; i++) await fs.writeFile(path.join(dir, `characters-2026020${i % 10}-12000${i % 10}-before-update.sql.gz`.replace('02020', '0202')), 'x');
  await fs.writeFile(path.join(dir, 'notes.txt'), 'ignored');
  await coa.pruneBackups(dir);
  const list = await coa.listBackups(root);
  assert.equal(list.filter(b => b.reason === 'before-update').length, 8);
  assert.equal(list.filter(b => b.reason === 'manual').length, 1, 'manual backups are never pruned');
  assert.equal(list.some(b => b.name === 'notes.txt'), false);
  assert.ok(list[0].name > list[list.length - 1].name, 'newest first');
  assert.match(list[0].when, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  await assert.rejects(coa.restore(root, '../../etc/passwd'), /Unknown backup/);
  await assert.rejects(coa.backupInternal(root, 'bad label!'), /Invalid backup label/);
});

test('troubleshoot reports a missing client and server instead of throwing', async () => {
  const coa = new CoaCustom({ fetchImpl: () => Promise.resolve({ ok: false }), notify: () => {} });
  const missing = path.join(os.tmpdir(), 'coa-does-not-exist-' + Date.now());
  const checks = await coa.troubleshoot({ serverPath: missing, clientPath: missing, realmlist: '127.0.0.1', realmMode: 'local', modules: { races: true }, versions: {} });
  const by = name => checks.find(c => c.name === name);
  assert.equal(by('Game folder').ok, false);
  assert.equal(by('CoACustomRace.exe').ok, false);
  assert.equal(by('Server scripts').ok, false);
  assert.equal(by('GitHub (updates)').ok, false);
  assert.ok(checks.every(c => ['true', 'false', 'warn'].includes(String(c.ok))));
  assert.ok(by('CoACustomRace.exe').fix.length > 0, 'every failure says how to fix it');
});

test('realm addresses accept IPs and host names only', () => {
  for (const ok of ['127.0.0.1', '25.12.34.56', 'my-server.example.org']) assert.equal(hostnameOk(ok), true);
  for (const bad of ['', "1.2.3.4'; DROP", 'a b', 'x'.repeat(300), null]) assert.equal(hostnameOk(bad), false);
  const found = networkAddresses();
  assert.ok(Array.isArray(found.lan) && Array.isArray(found.hamachi) && Array.isArray(found.tailscale));
  assert.equal(isTailscaleAddress('100.125.86.0'), true);
  assert.equal(isTailscaleAddress('100.64.0.1'), true);
  assert.equal(isTailscaleAddress('100.127.255.255'), true);
  assert.equal(isTailscaleAddress('100.63.255.255'), false);
  assert.equal(isTailscaleAddress('192.168.1.20'), false);
  const net = { lan: ['192.168.1.20'], hamachi: ['25.1.2.3'], tailscale: ['100.125.86.0'] };
  assert.equal(hostsHere('tailscale', '100.125.86.0', net), true);
  assert.equal(hostsHere('custom', '100.125.86.0', net), true);
  assert.equal(hostsHere('custom', '100.64.1.2', net), false);
});

test('new settings are sanitized', () => {
  const s = sanitize({ localMode: true, realmMode: 'tailscale', realmlist: '100.125.86.0', modules: { squid: true, races: 'yes' }, serverPath: 'relative', customOwned: ['Data/patch-T.MPQ', '../x;rm'] });
  assert.equal(s.localMode, true);
  assert.equal(s.realmMode, 'tailscale');
  assert.equal(s.realmlist, '100.125.86.0');
  assert.deepEqual(s.modules, { squid: true, devMenu: false, races: false });
  assert.equal(s.serverPath, '');
  assert.deepEqual(s.customOwned, ['Data/patch-T.MPQ']);
  assert.equal(sanitize({ realmlist: "1.1.1.1'--" }).realmlist, '127.0.0.1');
});

test('account passwords: SRP6 verifier is 32 bytes, case-insensitive and salt-bound', () => {
  const coa = new CoaCustom({ fetchImpl: null, notify: () => {} });
  const salt = Buffer.alloc(32, 7);
  const a = coa.srp6('Tester', 'Secret1', salt), b = coa.srp6('TESTER', 'secret1', salt), c = coa.srp6('Tester', 'Other', salt);
  assert.equal(a.verifier.length, 32);
  assert.deepEqual(a.verifier, b.verifier);
  assert.notDeepEqual(a.verifier, c.verifier);
});

test('account input and server deletion are validated before anything runs', async t => {
  const coa = new CoaCustom({ fetchImpl: null, notify: () => {} });
  await assert.rejects(coa.createAccount('x', { username: 'a b', password: 'secret' }), /2 to 16 letters/);
  await assert.rejects(coa.createAccount('x', { username: 'Tester', password: 'abc' }), /4 to 16 characters/);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'coa-del-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, 'keep.txt'), 'x');
  await assert.rejects(coa.deleteServer(dir), /does not look like a CoA server/);
  assert.equal((await fs.readdir(dir)).length, 1, 'a non-server folder is left alone');
});

test('SquidBots options are listed with their comments and only known keys can be saved', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coa-opt-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'Core/configs/modules');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'playerbots.conf'), '# How many bots\n# at most\nAiPlayerbot.MaxRandomBots = 500\n\nAiPlayerbot.RandomBotAccountPrefix = "rndbot"\n');
  const coa = new CoaCustom({ fetchImpl: null, notify: () => {} });
  const list = (await coa.botOptions(root)).filter(o => o.key.startsWith('AiPlayerbot.'));
  assert.deepEqual(list.map(o => [o.key, o.value, o.description]), [['AiPlayerbot.MaxRandomBots', '500', 'How many bots at most'], ['AiPlayerbot.RandomBotAccountPrefix', 'rndbot', '']]);
  await coa.setBotOption(root, 'AiPlayerbot.MaxRandomBots', 200);
  await coa.setBotOption(root, 'AiPlayerbot.RandomBotAccountPrefix', 'bots');
  assert.equal(await fs.readFile(path.join(dir, 'playerbots.conf'), 'utf8'), '# How many bots\n# at most\nAiPlayerbot.MaxRandomBots = 200\n\nAiPlayerbot.RandomBotAccountPrefix = "bots"\n');
  await assert.rejects(coa.setBotOption(root, 'worldserver.Evil', 1), /Unknown SquidBots option/);
  await assert.rejects(coa.setBotOption(root, 'AiPlayerbot.MaxRandomBots', '1\nX=2'), /not allowed/);
});

const racesMd = (extra = '') => `| Id | Race | Side | Credit | Notes |\n|---|---|---|---|---|\n| 105 | Gilgoblin | Horde | ilusixn | |\n${extra}`;
const releaseFetch = (assetText, headText) => async url => {
  if (url.includes('api.github.com')) return { ok: true, json: async () => ({ tag_name: 'v2', assets: [{ name: 'RACES.md', browser_download_url: 'https://asset/RACES.md' }] }) };
  if (url === 'https://asset/RACES.md') return { ok: assetText != null, text: async () => assetText };
  return { ok: headText != null, text: async () => headText };
};

test('race list prefers the latest release asset, then the repository file, then the cached copy', async t => {
  const cache = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'coa-races-')), 'cache.md');
  t.after(() => fs.rm(path.dirname(cache), { recursive: true, force: true }));
  const snag = racesMd('| 94 | Snagtooth | Alliance | ilusixn | |\n');
  let coa = new CoaCustom({ fetchImpl: releaseFetch(snag, racesMd()), notify: () => {}, racesCache: cache });
  assert.ok((await coa.races()).some(r => r.ids.includes(94)));
  coa = new CoaCustom({ fetchImpl: releaseFetch(null, null), notify: () => {}, racesCache: cache });
  assert.ok((await coa.races()).some(r => r.ids.includes(94)), 'offline: last cached copy');
  coa = new CoaCustom({ fetchImpl: releaseFetch(null, racesMd()), notify: () => {}, racesCache: cache });
  assert.ok(!(await coa.races()).some(r => r.ids.includes(94)), 'repository file when the asset is missing');
});

test('server race ids come from ChrRaces.dbc and unknown races cannot be allowed for bots', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coa-dbc-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dbc = Buffer.alloc(20 + 16);
  dbc.write('WDBC', 0, 'latin1'); dbc.writeUInt32LE(2, 4); dbc.writeUInt32LE(2, 8); dbc.writeUInt32LE(8, 12);
  dbc.writeUInt32LE(1, 20); dbc.writeUInt32LE(94, 28);
  await fs.mkdir(path.join(root, 'Data/dbc'), { recursive: true });
  await fs.writeFile(path.join(root, 'Data/dbc/ChrRaces.dbc'), dbc);
  const dir = path.join(root, 'Core/configs/modules'); await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'playerbots.conf'), 'AiPlayerbot.ExcludedBotRaces = ""\n'); await fs.writeFile(path.join(dir, 'coa_custom_races.conf'), '');
  const coa = new CoaCustom({ fetchImpl: null, notify: () => {} });
  const ids = await coa.serverRaceIds(root);
  assert.deepEqual([...ids], [1, 94]);
  await coa.setBotRaces(root, [1, 94, 105], [1, 94, 105], ids);
  assert.deepEqual((await coa.botRaces(root)).excluded, [105, 65]);
});

test('own servers get the races server half once per tag and never a replacement core', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coa-own-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'Settings'), { recursive: true });
  await fs.writeFile(path.join(root, 'Settings/own-server.json'), '{}');
  const coa = new CoaCustom({ fetchImpl: null, notify: () => {} });
  assert.equal(coa.isOwnServer(root), true);
  const calls = [];
  coa.latestRelease = async () => ({ tag_name: 'v2', assets: [] });
  coa.updateRacesServer = async (r, rel) => { calls.push(rel.tag_name); await fs.writeFile(coa.racesLedgerFile(r), JSON.stringify({ tag: rel.tag_name })); return rel.tag_name; };
  assert.deepEqual(await coa.syncRacesServer(root), { tag: 'v2', applied: true });
  assert.deepEqual(await coa.syncRacesServer(root), { tag: 'v2', applied: false });
  assert.equal(calls.length, 1);
  const src = require('node:fs').readFileSync(require.resolve('../src/coa-custom.cjs'), 'utf8');
  assert.match(src, /if \(!own\) await this\.updateRacesCore/);
});
