// CoA Custom Races additions: config switches, address checks and saved settings.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { CoaCustom, hostnameOk, networkAddresses, parseRaces } = require('../src/coa-custom.cjs');
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
  assert.deepEqual(await coa.botRaces(root), { excluded: [65], crashing: [72, 77] });
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
  assert.ok(Array.isArray(found.lan) && Array.isArray(found.hamachi));
});

test('new settings are sanitized', () => {
  const s = sanitize({ localMode: true, realmMode: 'hamachi', realmlist: '25.1.2.3', modules: { squid: true, races: 'yes' }, serverPath: 'relative', customOwned: ['Data/patch-T.MPQ', '../x;rm'] });
  assert.equal(s.localMode, true);
  assert.equal(s.realmMode, 'hamachi');
  assert.equal(s.realmlist, '25.1.2.3');
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
