const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Readable } = require('node:stream');
const { CoaCustom } = require('../src/coa-custom.cjs');
const { SquidDashboard, PIN, newer } = require('../src/squid-dashboard.cjs');

const temp = async t => { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'coa-dash-')); t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir; };
const confDir = root => path.join(root, 'Core/configs/modules');
async function server(t, files = {}) {
  const root = await temp(t);
  await fs.mkdir(confDir(root), { recursive: true });
  for (const [name, text] of Object.entries(files)) await fs.writeFile(path.join(confDir(root), name), text);
  return root;
}

test('the dashboard is pinned to a tag with file hashes, and tags compare by version', () => {
  assert.match(PIN.tag, /^v\d+\.\d+\.\d+$/);
  assert.equal(PIN.tag, 'v' + PIN.version);
  for (const digest of Object.values(PIN.files)) assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(newer('v3.1.0', 'v3.0.0'), true);
  assert.equal(newer('v2.9.4', 'v2.10.0'), false);
  assert.equal(newer('v3.1.0', 'v3.1.0'), false);
});

test('configure writes dashboard.json from the server and switches the live status file on once', async t => {
  const root = await server(t, { 'playerbots.conf': 'AiPlayerbot.CoaStatusFile = ""\nAiPlayerbot.CoaStatusIntervalSeconds = 5\n' });
  const coa = new CoaCustom({ fetchImpl: null, notify() {} });
  const dash = new SquidDashboard({ coa });
  await fs.mkdir(dash.dir(root), { recursive: true });
  const notes = await dash.configure(root);
  const settings = JSON.parse(await fs.readFile(path.join(dash.dir(root), 'dashboard.json'), 'utf8'));
  assert.equal(settings.repack, root.replace(/\\/g, '/'));
  assert.equal(settings.gmTools, false); assert.equal(settings.settingsPage, false); assert.equal(settings.webIcons, false);
  assert.ok(settings.botStatusFile.endsWith('/Core/Logs/bot-status.json'));
  assert.match(await coa.readConf(root, 'playerbots.conf', 'AiPlayerbot.CoaStatusFile'), /bot-status\.json$/);
  assert.equal(notes.length, 1);
  assert.equal((await dash.configure(root)).length, 0); // already set: nothing to say, nothing rewritten
});

test('configure leaves a module without the status option alone and says so', async t => {
  const root = await server(t, { 'playerbots.conf': 'AiPlayerbot.Enabled = 1\n' });
  const dash = new SquidDashboard({ coa: new CoaCustom({ fetchImpl: null, notify() {} }) });
  await fs.mkdir(dash.dir(root), { recursive: true });
  const notes = await dash.configure(root);
  assert.equal(await dash.coa.readConf(root, 'playerbots.conf', 'AiPlayerbot.CoaStatusFile'), null);
  assert.match(notes[0], /no live status/);
});

test('install refuses a download whose files do not match the pinned tag', async t => {
  const root = await temp(t);
  const src = path.join(root, 'pkg/squidbots-dashboard-fake'); await fs.mkdir(src, { recursive: true });
  for (const file of Object.keys(PIN.files)) { await fs.mkdir(path.dirname(path.join(src, file)), { recursive: true }); await fs.writeFile(path.join(src, file), 'tampered'); }
  const tgz = path.join(root, 'fake.tgz');
  assert.equal(spawnSync(path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'tar.exe'), ['-czf', tgz, '-C', path.join(root, 'pkg'), 'squidbots-dashboard-fake']).status, 0);
  const coa = new CoaCustom({ fetchImpl: async () => ({ ok: true, headers: { get: () => null }, body: Readable.toWeb(fss.createReadStream(tgz)) }), notify() {} });
  const dash = new SquidDashboard({ coa });
  const target = path.join(root, 'server'); await fs.mkdir(target);
  await assert.rejects(dash.install(target), /does not match v3\.1\.0/);
  assert.equal(await dash.installedVersion(target), '');
});

test('start needs an installed dashboard and a running database, and never runs without them', async t => {
  const root = await server(t);
  const coa = new CoaCustom({ fetchImpl: null, notify() {} });
  const dash = new SquidDashboard({ coa });
  await assert.rejects(dash.start(root), /not installed/);
  await fs.mkdir(dash.dir(root), { recursive: true }); await fs.writeFile(path.join(dash.dir(root), 'VERSION'), '3.1.0\n');
  coa.dbReady = async () => false;
  await assert.rejects(dash.start(root), /Start the server first/);
  assert.equal(dash.isRunning(root), false);
  assert.deepEqual((await dash.info(root)).running, false);
});

test('bot settings come from the module schema, are validated and saved, also when not active in the file', async t => {
  const schema = { groups: { population: 'Population' }, settings: [
    { key: 'AiPlayerbot.MaxRandomBots', group: 'population', title: 'Max', description: 'd', type: 'int', default: 500 },
    { key: 'AiPlayerbot.RandomBotMaxLevel', group: 'population', title: 'Level', description: '', type: 'int', default: 60, min: 1, max: 80 },
    { key: 'AiPlayerbot.RandomBotAutologin', group: 'population', title: 'Auto', description: '', type: 'bool', default: true },
    { key: 'AiPlayerbot.Name', group: 'population', title: 'Name', description: '', type: 'string', default: 'x' },
    { key: 'Evil.Key', group: 'population', title: 'x', type: 'int', default: 1 }] };
  const root = await server(t, { 'playerbots.conf': 'AiPlayerbot.MaxRandomBots = 800\n', 'playerbots.conf.settings.json': JSON.stringify(schema) });
  const coa = new CoaCustom({ fetchImpl: null, notify() {} });
  const read = await coa.botSchema(root);
  assert.equal(read.settings.length, 4); // the key outside AiPlayerbot.* is dropped
  assert.equal(read.settings.find(o => o.key.endsWith('MaxRandomBots')).value, 800);
  assert.equal(read.settings.find(o => o.key.endsWith('Autologin')).value, true); // not in the file: the schema default
  assert.deepEqual(await coa.setBotSchemaOption(root, 'AiPlayerbot.MaxRandomBots', '1200'), { key: 'AiPlayerbot.MaxRandomBots', value: 1200 });
  await assert.rejects(coa.setBotSchemaOption(root, 'AiPlayerbot.RandomBotMaxLevel', 99), /between 1 and 80/);
  await assert.rejects(coa.setBotSchemaOption(root, 'AiPlayerbot.MaxRandomBots', 'abc'), /valid number/);
  await assert.rejects(coa.setBotSchemaOption(root, 'AiPlayerbot.Name', 'a"b'), /not allowed/);
  assert.equal((await coa.setBotSchemaOption(root, 'AiPlayerbot.RandomBotAutologin', false)).value, false);
  const text = await fs.readFile(path.join(confDir(root), 'playerbots.conf'), 'utf8');
  assert.match(text, /^AiPlayerbot\.MaxRandomBots = 1200$/m);
  assert.match(text, /^AiPlayerbot\.RandomBotAutologin = 0$/m);
  assert.equal(await new CoaCustom({ fetchImpl: null, notify() {} }).botSchema(await temp(t)), null); // no schema file: the raw list is the fallback
});

test('the auction house bot options write the keys the compiled module reads', async t => {
  const root = await server(t, { 'mod_ahbot.conf': 'AuctionHouseBot.CoA.ObtainableItemsOnly = true\nAuctionHouseBot.Enable = true\nAuctionHouseBot.ItemsPerCycle = 150\nAuctionHouseBot.Buyer.Enabled = false\n' });
  const coa = new CoaCustom({ fetchImpl: null, notify() {} });
  assert.deepEqual(await coa.ahBot(root), { supported: true, enable: true, buyer: false, itemsPerCycle: 150 });
  assert.equal((await coa.setAhBot(root, 'buyer', true)).buyer, true);
  assert.equal((await coa.setAhBot(root, 'itemsPerCycle', '300')).itemsPerCycle, 300);
  assert.equal((await coa.setAhBot(root, 'enable', false)).enable, false);
  await assert.rejects(coa.setAhBot(root, 'itemsPerCycle', 0), /1 to 2000/);
  await assert.rejects(coa.setAhBot(root, 'GUIDs', 1), /Unknown/);
  const text = await fs.readFile(path.join(confDir(root), 'mod_ahbot.conf'), 'utf8');
  assert.match(text, /^AuctionHouseBot\.Buyer\.Enabled = true$/m);
  assert.match(text, /^AuctionHouseBot\.Enable = false$/m);
  assert.equal((await coa.ahBot(await server(t, { 'mod_ahbot.conf': 'AuctionHouseBot.EnableSeller = 0\n' }))).supported, false); // another module's file
});
