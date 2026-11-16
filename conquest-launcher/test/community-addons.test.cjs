const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { CommunityAddons, loadCatalog, validateCatalog, readZipEntries, checkEntries, CHECK_TTL } = require('../src/community-addons.cjs');

// Minimal "stored" zip writer; opts lets a test mark an entry as encrypted or as a symlink.
function zip(items) {
  const locals = []; const central = []; let offset = 0;
  for (const item of items) {
    const name = Buffer.from(item.name); const data = Buffer.from(item.data ?? '');
    const flags = item.encrypted ? 1 : 0; const crc = zlib.crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(item.symlink ? 0x031e : 20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(flags, 8);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(item.symlink ? (0o120777 << 16) >>> 0 : 0, 38); cd.writeUInt32LE(offset, 42);
    locals.push(local, name, data); central.push(cd, name); offset += 30 + name.length + data.length;
  }
  const cdBuf = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(items.length, 8); end.writeUInt16LE(items.length, 10); end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, end]);
}
const sha = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'coa-ca-test-'));
const entry = (id, extra = {}) => ({
  id, name: id, description: 'd', author: 'a', license: 'MIT', homepage: 'https://github.com/o/r',
  source: { type: 'release', repo: 'o/r', assets: [{ pattern: '^a\\.zip$' }] }, archive: { format: 'zip', base: 'AddOns' }, targets: ['Interface/AddOns/Demo'], ...extra
});
// Fake GitHub: releases listing plus asset downloads. `assets` = [{ name, buffer }]; counts API calls in api.calls.
function github(assets, { tag = 'v1', prerelease = [] } = {}) {
  const api = { calls: 0 };
  api.fetch = async url => {
    if (url.includes('api.github.com')) {
      api.calls++;
      const list = assets.map(a => ({ name: a.name, size: a.buffer.length, digest: a.badDigest ? 'sha256:' + '0'.repeat(64) : 'sha256:' + sha(a.buffer), browser_download_url: `https://github.com/o/r/releases/download/${tag}/${a.name}` }));
      const json = [...prerelease.map(t => ({ tag_name: t, prerelease: true, assets: [] })), { tag_name: tag, prerelease: false, assets: list }];
      return { ok: true, status: 200, json: async () => json };
    }
    const found = assets.find(a => url.endsWith('/' + a.name));
    return found ? { ok: true, status: 200, body: Readable.toWeb(Readable.from([found.buffer])) } : { ok: false, status: 404 };
  };
  return api;
}
const setup = () => { const client = dir(); fs.mkdirSync(path.join(client, 'Interface', 'AddOns'), { recursive: true }); return { client, tmp: dir() }; };
const service = (catalog, api, tmp, extra = {}) => new CommunityAddons({ fetchImpl: api.fetch, catalog: validateCatalog({ schema: 1, addons: catalog }), tmpRoot: tmp, ...extra });

test('the shipped catalog is valid and every entry credits author and licence', () => {
  const catalog = loadCatalog();
  assert.deepEqual(catalog.map(a => a.id), ['coa-item-search', 'coa-teleport', 'questie-x-coa', 'elvui-coa', 'willitdie', 'azeroth-fr']);
  for (const a of catalog) { assert.ok(a.author && a.license && a.homepage && a.description); assert.ok(a.targets.length); }
  assert.match(catalog.find(a => a.id === 'azeroth-fr').description, /FRENCH translation/);
});

test('catalog validation rejects bad ids, targets, links and unpinned tarballs', () => {
  const bad = patch => () => validateCatalog({ schema: 1, addons: [entry('ok-one', patch)] });
  assert.doesNotThrow(bad({}));
  assert.throws(bad({ id: 'Bad Id' }));
  assert.throws(bad({ targets: ['Interface/AddOns/../x'] }));
  assert.throws(bad({ targets: ['Data/patch-x.mpq'] }));
  assert.throws(bad({ homepage: 'https://evil.example/x' }));
  assert.throws(bad({ source: { type: 'tarball', repo: 'o/r', commit: 'main' } }));
  assert.throws(() => validateCatalog({ schema: 1, addons: [entry('same-id'), entry('same-id')] }));
});

test('archive checks refuse zip-slip, links, passwords and duplicates', async () => {
  const folder = dir();
  const check = async items => { const f = path.join(folder, 'z.zip'); fs.writeFileSync(f, zip(items)); return checkEntries(await readZipEntries(f)); };
  assert.equal(await check([{ name: 'Demo/a.lua', data: 'x' }]), 1);
  await assert.rejects(check([{ name: '../evil.lua', data: 'x' }]));
  await assert.rejects(check([{ name: 'C:/evil.lua', data: 'x' }]));
  await assert.rejects(check([{ name: 'Demo/a.lua', data: 'x', encrypted: true }]), /password/);
  await assert.rejects(check([{ name: 'Demo/link', data: 'x', symlink: true }]), /link/);
  await assert.rejects(check([{ name: 'Demo/a.lua', data: 'x' }, { name: 'demo/A.lua', data: 'y' }]), /twice/);
});

test('install copies addon files only, records them, and remove deletes only what was installed', async () => {
  const { client, tmp } = setup();
  const api = github([{ name: 'a.zip', buffer: zip([{ name: 'Demo/Demo.toc', data: 't' }, { name: 'Demo/main.lua', data: 'l' }, { name: 'Demo/art/x.tga', data: 'i' }, { name: 'Demo/run.bat', data: 'evil' }, { name: 'Demo/tool.exe', data: 'evil' }, { name: 'Other/x.lua', data: 'no' }]) }]);
  const svc = service([entry('demo-addon')], api, tmp);
  const result = await svc.install('demo-addon', client);
  assert.equal(result.files, 3); assert.equal(result.skipped, 2);
  const base = path.join(client, 'Interface', 'AddOns');
  assert.ok(fs.existsSync(path.join(base, 'Demo', 'main.lua')));
  assert.ok(!fs.existsSync(path.join(base, 'Demo', 'run.bat')) && !fs.existsSync(path.join(base, 'Demo', 'tool.exe')) && !fs.existsSync(path.join(base, 'Other')));
  assert.equal((await svc.list(client, { check: false }))[0].status, 'installed');
  fs.writeFileSync(path.join(base, 'Demo', 'my-notes.lua'), 'mine'); // the player's own file inside the folder
  assert.equal((await svc.remove('demo-addon', client)).removed, 3);
  assert.ok(fs.existsSync(path.join(base, 'Demo', 'my-notes.lua')), 'player file survives remove');
  assert.ok(!fs.existsSync(path.join(base, 'Demo', 'main.lua')));
  await assert.rejects(svc.remove('demo-addon', client), /not installed by the launcher/);
});

test('a folder the launcher did not install is never overwritten or removed', async () => {
  const { client, tmp } = setup();
  const mine = path.join(client, 'Interface', 'AddOns', 'Demo'); fs.mkdirSync(mine); fs.writeFileSync(path.join(mine, 'x.lua'), 'mine');
  const api = github([{ name: 'a.zip', buffer: zip([{ name: 'Demo/main.lua', data: 'l' }]) }]);
  const svc = service([entry('demo-addon')], api, tmp);
  assert.equal((await svc.list(client, { check: false }))[0].status, 'foreign');
  await assert.rejects(svc.install('demo-addon', client), /not installed by the launcher/);
  await assert.rejects(svc.remove('demo-addon', client), /not installed by the launcher/);
  assert.equal(fs.readFileSync(path.join(mine, 'x.lua'), 'utf8'), 'mine');
});

test('a conflicting addon folder blocks the install', async () => {
  const { client, tmp } = setup();
  fs.mkdirSync(path.join(client, 'Interface', 'AddOns', 'Questie'));
  const svc = service([entry('demo-addon', { conflicts: ['Questie'] })], github([{ name: 'a.zip', buffer: zip([{ name: 'Demo/a.lua', data: 'x' }]) }]), tmp);
  await assert.rejects(svc.install('demo-addon', client), /cannot be installed while/);
});

test('a damaged download (wrong sha256) installs nothing', async () => {
  const { client, tmp } = setup();
  const api = github([{ name: 'a.zip', buffer: zip([{ name: 'Demo/a.lua', data: 'x' }]), badDigest: true }]);
  await assert.rejects(service([entry('demo-addon')], api, tmp).install('demo-addon', client), /checksum/);
  assert.ok(!fs.existsSync(path.join(client, 'Interface', 'AddOns', 'Demo')));
  assert.deepEqual(fs.readdirSync(tmp), [], 'scratch folder cleaned up');
});

test('update: a newer release replaces the owned files, and removed files go away', async () => {
  const { client, tmp } = setup();
  let api = github([{ name: 'a.zip', buffer: zip([{ name: 'Demo/a.lua', data: '1' }, { name: 'Demo/old.lua', data: 'o' }]) }], { tag: 'v1' });
  const holder = { fetch: (...args) => api.fetch(...args) };
  const svc = service([entry('demo-addon')], holder, tmp);
  await svc.install('demo-addon', client);
  api = github([{ name: 'a.zip', buffer: zip([{ name: 'Demo/a.lua', data: '2' }]) }], { tag: 'v2', prerelease: ['v3-beta'] });
  assert.equal((await svc.list(client, { force: true }))[0].status, 'update');
  const result = await svc.install('demo-addon', client);
  assert.equal(result.version, 'v2'); assert.equal(result.updated, true);
  const base = path.join(client, 'Interface', 'AddOns', 'Demo');
  assert.equal(fs.readFileSync(path.join(base, 'a.lua'), 'utf8'), '2'); assert.ok(!fs.existsSync(path.join(base, 'old.lua')));
});

test('update checks are cached for six hours and forced checks go to GitHub', async () => {
  const { client, tmp } = setup(); let clock = 1000;
  const api = github([{ name: 'a.zip', buffer: zip([{ name: 'Demo/a.lua', data: '1' }]) }]);
  const svc = service([entry('demo-addon')], api, tmp, { now: () => clock, cacheFile: path.join(tmp, 'cache.json') });
  await svc.list(client); await svc.list(client); assert.equal(api.calls, 1);
  clock += CHECK_TTL - 1; await svc.list(client); assert.equal(api.calls, 1);
  clock += 2; await svc.list(client); assert.equal(api.calls, 2);
  await svc.list(client, { force: true }); assert.equal(api.calls, 3);
  const again = service([entry('demo-addon')], api, tmp, { now: () => clock, cacheFile: path.join(tmp, 'cache.json') });
  await again.list(client); assert.equal(api.calls, 3, 'the cache file survives a restart');
});

test('a release with several asset parts (like a 2.5 GB archive) is joined in order, each part verified', async () => {
  const { client, tmp } = setup();
  const whole = zip([{ name: 'Voices/Voices.toc', data: 't' }, { name: 'Voices/sound/a.ogg', data: Buffer.alloc(3000, 7).toString('latin1') }]);
  const cut = [0, 1000, 2200, whole.length];
  const parts = [1, 2, 3].map(n => ({ name: `big.zip.00${n}`, buffer: whole.subarray(cut[n - 1], cut[n]) }));
  const multi = { source: { type: 'release', repo: 'o/r', assets: [1, 2, 3].map(n => ({ pattern: `^big\\.zip\\.00${n}$` })) }, targets: ['Interface/AddOns/Voices'] };
  const svc = service([entry('voices-like', multi)], github(parts), tmp);
  const result = await svc.install('voices-like', client);
  assert.equal(result.files, 2);
  assert.equal(fs.statSync(path.join(client, 'Interface', 'AddOns', 'Voices', 'sound', 'a.ogg')).size, 3000);
  // one damaged part stops everything
  const { client: c2, tmp: t2 } = setup(); parts[1].badDigest = true;
  await assert.rejects(service([entry('voices-like', multi)], github(parts), t2).install('voices-like', c2), /checksum/);
  assert.ok(!fs.existsSync(path.join(c2, 'Interface', 'AddOns', 'Voices')));
});

test('a Curator-like archive: watchdog scripts are never installed and the Startup folder is never touched', async () => {
  const { client, tmp } = setup();
  const api = github([{ name: 'a.zip', buffer: zip([{ name: 'Curator/Curator.toc', data: 't' }, { name: 'Curator/main.lua', data: 'l' }, { name: 'archivist-watchdog.cmd', data: 'x' }, { name: 'archivist-watchdog.vbs', data: 'x' }, { name: 'INSTALL ADDON.bat', data: 'x' }, { name: 'Curator/INSTALL ADDON.bat', data: 'x' }]) }]);
  const svc = service([entry('curator-like', { targets: ['Interface/AddOns/Curator'] })], api, tmp);
  const before = process.env.APPDATA;
  const result = await svc.install('curator-like', client);
  assert.equal(result.files, 2);
  const all = []; (function walk(d) { for (const i of fs.readdirSync(d, { withFileTypes: true })) i.isDirectory() ? walk(path.join(d, i.name)) : all.push(i.name); })(client);
  assert.ok(!all.some(n => /\.(cmd|vbs|bat)$/i.test(n)), 'no script reached the client');
  assert.equal(process.env.APPDATA, before);
});

test('only one operation runs at a time', async () => {
  const { client, tmp } = setup();
  const svc = service([entry('demo-addon')], github([{ name: 'a.zip', buffer: zip([{ name: 'Demo/a.lua', data: 'x' }]) }]), tmp);
  const first = svc.install('demo-addon', client);
  await assert.rejects(svc.install('demo-addon', client), /Wait for the current/);
  await first;
});
