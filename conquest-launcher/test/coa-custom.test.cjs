// CoA Custom Races additions: config switches, address checks and saved settings.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { CoaCustom, hostnameOk, networkAddresses } = require('../src/coa-custom.cjs');
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
