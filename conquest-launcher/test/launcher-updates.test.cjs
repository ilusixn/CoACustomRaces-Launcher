const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { EventEmitter } = require('node:events');

// A stand-in for electron-updater's autoUpdater: checkForUpdates() plays the events a real check would emit.
function load(script) {
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => script(updater);
  updater.quitAndInstall = (...args) => { updater.quit = args; };
  const original = Module._load;
  Module._load = function (request, ...rest) { return request === 'electron-updater' ? { autoUpdater: updater } : original.call(this, request, ...rest); };
  delete require.cache[require.resolve('../src/launcher-updates.cjs')];
  const { createLauncherUpdates } = require('../src/launcher-updates.cjs');
  const seen = []; let restartChecked = 0;
  const service = createLauncherUpdates({ isPackaged: true }, status => seen.push(status), async () => { restartChecked++; });
  Module._load = original;
  return { updater, service, seen, restartChecked: () => restartChecked };
}

test('a newer release goes checking, downloading, downloaded, and installs only after the restart check', async () => {
  const { updater, service, seen, restartChecked } = load(u => { u.emit('checking-for-update'); u.emit('update-available', { version: '1.0.2' }); u.emit('download-progress', { percent: 42 }); u.emit('update-downloaded', { version: '1.0.2' }); });
  assert.equal(updater.autoDownload, true); assert.equal(updater.autoInstallOnAppQuit, false); assert.equal(updater.allowDowngrade, false);
  assert.equal(service.status.phase, 'idle');
  const status = await service.check();
  assert.deepEqual(seen.map(s => s.phase), ['checking', 'downloading', 'downloading', 'downloaded']);
  assert.equal(seen[2].percent, 42);
  assert.equal(status.phase, 'downloaded'); assert.match(status.message, /1\.0\.2 is ready\. Restart to install/);
  await service.check(); // a downloaded update is not checked again
  assert.equal(seen.length, 4);
  await service.install();
  assert.equal(restartChecked(), 1); assert.deepEqual(updater.quit, [false, true]);
});

test('no newer release: the launcher says it is up to date', async () => {
  const { service } = load(u => { u.emit('checking-for-update'); u.emit('update-not-available', {}); });
  assert.deepEqual([(await service.check()).phase, service.status.message], ['ready', 'Your launcher is up to date.']);
});

test('an unreachable feed or a thrown error becomes an error status and checks can be retried', async () => {
  let fail = true;
  const { service } = load(u => { if (fail) throw new Error('net::ERR_INTERNET_DISCONNECTED'); u.emit('update-not-available', {}); });
  const first = await service.check();
  assert.equal(first.phase, 'error'); assert.match(first.message, /ERR_INTERNET_DISCONNECTED/);
  fail = false;
  assert.equal((await service.check()).phase, 'ready');
  await assert.rejects(service.install(), /No launcher update is ready/);
});

test('an updater error event is reported, and development builds never check', async () => {
  const { updater, service } = load(u => { u.emit('error', new Error('latest.yml not found')); });
  assert.match((await service.check()).message, /latest\.yml not found/);
  const dev = require('../src/launcher-updates.cjs').createLauncherUpdates({ isPackaged: false }, () => {}, async () => {});
  assert.equal(dev.status.phase, 'development'); assert.equal((await dev.check()).phase, 'development');
  assert.ok(updater);
});
