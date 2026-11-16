const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServerTools, WORLD_OPTIONS, describe } = require('../src/server-tools.cjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'coa-st-'));
const put = (root, rel, text = 'x') => { const f = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const TEMPLATE = `# header
#
#    Rate.XP.Kill
#    Rate.XP.Quest
#        Description: Experience rates (outside battleground)
#        Default:     1 - (Rate.XP.Kill)
#                     1 - (Rate.XP.Quest)

Rate.XP.Kill      = 1
Rate.XP.Quest     = 1

#
#    AllFlightPaths
#        Description: Character knows all flight paths (of both teams) after creation.
#        Default:     0 - (Disabled)

AllFlightPaths = 0
DataDir = "@DATA@"
`;
function fakeServer(root = tmp()) {
  put(root, 'Scripts/manage.py', '#'); put(root, 'Core/placeholder.txt'); put(root, 'Settings/worldserver.conf.template', TEMPLATE.replace(/\n/g, '\r\n'));
  put(root, 'Settings/repack.json', JSON.stringify({ authPort: 3724, worldPort: 8085, mysqlPort: 3306, raPort: 3443 }));
  put(root, 'Core/configs/worldserver.conf.dist', 'Rate.XP.Kill = 1\nRate.XP.Quest = 1\nAllFlightPaths = 0\n');
  put(root, 'mysql/my.ini', `basedir="${root.replace(/\\/g, '/')}/mysql"\n`); put(root, 'Settings/paths.json', JSON.stringify({ root }));
  put(root, 'mysql/data/ibdata1', 'D'.repeat(5000)); put(root, '.state/world.json', '{}'); put(root, 'Data/big.mpq', 'M'.repeat(100));
  return root;
}
// A stand-in for CoaCustom: counts characters from a function, so tests can make the copy "lose" characters.
function fakeCoa(count = () => '3\t2') {
  const calls = [];
  return { calls, foreignServer: () => false, exclusive: action => action(), manage: async (root, verb) => { calls.push([verb, root]); }, withDatabase: async (root, action) => action(),
    sql: async root => { calls.push(['sql', root]); return count(root); }, backupInternal: async () => ({ name: 'characters-20260101-000000-before-move.sql.gz' }), portBusy: async () => false };
}
const tools = (coa, running = false) => { const t = new ServerTools({ coa }); t.status = async () => ({ mysql: running, auth: false, world: false, relay: false }); return t; };

test('checkFolder refuses drive roots, network and OneDrive folders, nested or overlapping folders, and non-empty folders', async () => {
  const t = tools(fakeCoa()); const source = fakeServer(); const base = tmp();
  const bad = async (dest, opts) => (await t.checkFolder(dest, opts)).problems.join(' ');
  assert.match(await bad('\\\\nas\\share\\server'), /Network/);
  assert.match(await bad(path.parse(base).root), /not the drive itself/);
  assert.match(await bad(path.join(base, 'OneDrive', 'CoA')), /OneDrive/);
  assert.match(await bad(path.join(source, 'inner'), { source }), /inside/);
  assert.match(await bad(path.dirname(source), { source }), /contain/);
  assert.match(await bad(source, { source }), /already in/);
  assert.match(await bad('relative/path'), /full folder path/);
  assert.match(await bad(path.join(base, 'x'.repeat(130))), /too long/);
  put(base, 'busy/file.txt'); assert.match(await bad(path.join(base, 'busy')), /empty/);
  assert.match(await bad(path.join(base, 'ok'), { bytes: 2 ** 60 }), /Not enough free space/);
  assert.equal(await bad(path.join(base, 'fine folder with spaces')), '', 'spaces are fine');
  assert.match((await t.checkFolder(path.join(base, 'café'))).warnings.join(' '), /accents/);
});

test('world options: descriptions come from the comments, edits go to the template and keep line endings', async () => {
  const root = fakeServer(); const t = tools(fakeCoa());
  const { options } = await t.worldOptions(root);
  const xp = options.find(o => o.key === 'Rate.XP.Kill');
  assert.equal(xp.value, 1); assert.equal(xp.default, 1); assert.match(xp.description, /^Experience rates \(outside battleground\)$/);
  assert.equal(options.find(o => o.key === 'AllFlightPaths').description, 'Character knows all flight paths (of both teams) after creation.');
  assert.ok(!options.some(o => o.key === 'DataDir'), 'paths and credentials are never offered');
  await t.setWorldOption(root, 'Rate.XP.Kill', 3.5);
  const file = path.join(root, 'Settings/worldserver.conf.template');
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /Rate\.XP\.Kill      = 3\.5\r\n/); assert.match(text, /DataDir = "@DATA@"/);
  assert.equal(fs.readFileSync(file + '.launcher-original', 'utf8').includes('Rate.XP.Kill      = 1'), true);
  assert.equal((await t.worldOptions(root)).options.find(o => o.key === 'Rate.XP.Kill').value, 3.5);
  await t.setWorldOption(root, 'AllFlightPaths', 1); assert.match(fs.readFileSync(file, 'utf8'), /AllFlightPaths = 1\r\n/);
});

test('world options reject unknown keys, bad numbers and secrets', async () => {
  const root = fakeServer(); const t = tools(fakeCoa());
  await assert.rejects(t.setWorldOption(root, 'LoginDatabaseInfo', 1), /cannot be changed/);
  await assert.rejects(t.setWorldOption(root, 'DataDir', 1), /cannot be changed/);
  await assert.rejects(t.setWorldOption(root, 'Rate.XP.Kill', 'abc'), /number/);
  await assert.rejects(t.setWorldOption(root, 'Rate.XP.Kill', -1), /lowest/);
  await assert.rejects(t.setWorldOption(root, 'Rate.XP.Kill', 100000), /highest/);
  await assert.rejects(t.setWorldOption(root, 'AllFlightPaths', 2), /on \(1\) or off/);
  assert.ok(WORLD_OPTIONS.every(o => !/Password|Database|Dir$|Executable/i.test(o.key)));
  assert.equal(describe(['#', '# plain comment', 'Key = 1'], 2), 'plain comment');
});

test('ports: only world, MySQL and RA change, they must differ, and the server must be stopped', async () => {
  const root = fakeServer();
  await assert.rejects(tools(fakeCoa(), true).setPorts(root, { worldPort: 9000 }), /Stop the server/);
  const t = tools(fakeCoa());
  assert.equal((await t.setPorts(root, { worldPort: 9000, authPort: 1111 })).worldPort, 9000);
  assert.equal((await t.ports(root)).authPort, 3724, 'the login port is never changed');
  await assert.rejects(t.setPorts(root, { worldPort: 3306 }), /different/);
  await assert.rejects(t.setPorts(root, { raPort: 80 }), /1024/);
  const busy = fakeCoa(); busy.portBusy = async () => true;
  await assert.rejects(tools(busy).setPorts(root, { raPort: 5000 }), /already used/);
});

test('move copies, rewrites the old folder inside the copy, verifies characters, and leaves the original alone', async () => {
  const source = fakeServer(); const dest = path.join(tmp(), 'new server');
  const coa = fakeCoa(); const t = tools(coa); const steps = [];
  t.notify = s => steps.push(s.message);
  const result = await t.move(source, dest, { beforeStop: async () => steps.push('dashboard stopped') });
  assert.equal(result.characters, 3); assert.equal(result.accounts, 2);
  assert.ok(fs.existsSync(path.join(dest, 'mysql/data/ibdata1')) && fs.statSync(path.join(dest, 'mysql/data/ibdata1')).size === 5000);
  assert.ok(!fs.existsSync(path.join(dest, '.state')), 'old process records are not copied');
  assert.match(fs.readFileSync(path.join(dest, 'mysql/my.ini'), 'utf8'), new RegExp(dest.replace(/\\/g, '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dest, 'Settings/paths.json'), 'utf8')).root, dest, 'JSON-escaped backslashes are rewritten too');
  assert.match(fs.readFileSync(path.join(source, 'mysql/my.ini'), 'utf8'), /coa-st-/, 'the original is untouched');
  assert.ok(fs.existsSync(path.join(source, '.state/world.json')));
  assert.deepEqual(coa.calls.filter(c => c[0] === 'stop-all' || c[0] === 'start-mysql').map(c => c[0] + ':' + (c[1] === source ? 'old' : 'new')), ['stop-all:old', 'start-mysql:new', 'stop-all:new']);
  assert.ok(steps.includes('dashboard stopped') && steps.some(s => /Copying/.test(s)));
});

test('a move whose copy has different characters is undone: the copy is removed, the original stays', async () => {
  const source = fakeServer(); const dest = path.join(tmp(), 'new server');
  const t = tools(fakeCoa(root => root === source ? '3\t2' : '1\t2'));
  await assert.rejects(t.move(source, dest), /different characters/);
  assert.ok(!fs.existsSync(dest), 'the new folder was removed');
  assert.ok(fs.existsSync(path.join(source, 'mysql/data/ibdata1')));
});

test('move refuses a running server, bad targets, and does not copy anything then', async () => {
  const source = fakeServer(); const base = tmp();
  const stuck = tools(fakeCoa()); stuck.status = async () => ({ mysql: true });
  await assert.rejects(stuck.move(source, path.join(base, 'a')), /could not be stopped completely/);
  assert.ok(!fs.existsSync(path.join(base, 'a', 'Scripts')));
  await assert.rejects(tools(fakeCoa()).move(source, path.join(source, 'inside')), /inside/);
  await assert.rejects(tools(fakeCoa()).move(source, 'relative-folder'), /full folder path/);
  assert.ok(!fs.existsSync(path.resolve('relative-folder')), 'nothing is created next to the launcher');
  put(base, 'full/x.txt'); await assert.rejects(tools(fakeCoa()).move(source, path.join(base, 'full')), /empty/);
});

test('delete old copy: only a stopped, non-active server folder', async () => {
  const oldRoot = fakeServer(); const active = fakeServer();
  await assert.rejects(tools(fakeCoa()).deleteOld(oldRoot, oldRoot), /active server/);
  await assert.rejects(tools(fakeCoa()).deleteOld(path.dirname(active), active), /active server/);
  await assert.rejects(tools(fakeCoa(), true).deleteOld(oldRoot, active), /running/);
  const notServer = tmp(); put(notServer, 'file.txt');
  await assert.rejects(tools(fakeCoa()).deleteOld(notServer, active), /no longer looks like/);
  await tools(fakeCoa()).deleteOld(oldRoot, active);
  assert.ok(!fs.existsSync(oldRoot) && fs.existsSync(active));
});
