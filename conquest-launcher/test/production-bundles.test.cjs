const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { generate, bundleNames } = require('../tools/production-bundles.cjs');

function bridge(source) {
  let exposed; const calls = [], listeners = new Map();
  const ipcRenderer = {
    invoke: async (...args) => { calls.push(args); return { ok: true, value: 'fixture' }; },
    on: (name, callback) => listeners.set(name, callback),
    removeListener: (name, callback) => { assert.equal(listeners.get(name), callback); listeners.delete(name); },
  };
  vm.runInNewContext(source, { require: name => {
    assert.equal(name, 'electron');
    return { ipcRenderer, contextBridge: { exposeInMainWorld: (name, value) => { assert.equal(name, 'launcher'); exposed = value; } } };
  } });
  return { exposed, calls, listeners, ipcRenderer };
}

test('production bundles keep preload API/IPC intact and ship only transformed first-party scripts', async () => {
  const root = path.resolve(__dirname, '..');
  const sources = ['src/main.cjs', 'src/preload.cjs', 'public/app.js', 'public/updates.js'];
  const original = await Promise.all(sources.map(name => fs.readFile(path.join(root, name))));
  const { output } = await generate();
  for (let i = 0; i < sources.length; i++) assert.deepEqual(await fs.readFile(path.join(root, sources[i])), original[i], 'development source must not change');
  for (const name of bundleNames) {
    const code = await fs.readFile(path.join(output, name), 'utf8');
    new vm.Script(code);
    assert.doesNotMatch(code, /sourceMappingURL|sourcesContent|class ClientUpdater|function submitBugReport/);
  }
  const clean = bridge(original[1].toString()), built = bridge(await fs.readFile(path.join(output, 'runtime/b.cjs'), 'utf8'));
  assert.deepEqual(Object.keys(built.exposed), Object.keys(clean.exposed));
  assert.equal(Object.isFrozen(built.exposed), true);
  for (const name of Object.keys(clean.exposed)) {
    if (name.startsWith('on')) {
      const observed = [[], []];
      for (const [i, item] of [clean, built].entries()) {
        const remove = item.exposed[name](value => observed[i].push(value));
        assert.equal(item.listeners.size, 1);
        [...item.listeners.values()][0]({}, 'fixture status'); remove(); assert.equal(item.listeners.size, 0);
      }
      assert.deepEqual(observed[0], observed[1]);
    } else {
      const args = ['fixture', true, { id: 1 }, 'four', false];
      assert.equal(await clean.exposed[name](...args), await built.exposed[name](...args));
    }
  }
  assert.equal(JSON.stringify(clean.calls), JSON.stringify(built.calls));
  built.ipcRenderer.invoke = async () => ({ ok: false, error: 'fixture failure' });
  await assert.rejects(built.exposed.bootstrap(), /fixture failure/);
  const html = await fs.readFile(path.join(output, 'public/index.html'), 'utf8');
  assert.deepEqual([...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1]), ['builder/data/coa-data.js', 'c.js']);
  assert.match(html, /script-src 'self'/); assert.doesNotMatch(html, /unsafe-eval/);
});

test('production package retains update identity and safe installer while excluding development entry points', async () => {
  const config = require('../package.json');
  assert.equal(config.main, 'src/main.cjs', 'development entry point remains readable');
  assert.equal(config.build.extraMetadata.main, 'runtime/a.cjs');
  assert.equal(config.build.appId, 'com.ilusixn.coacustomraces.launcher');
  assert.equal(config.build.executableName, 'CoACustomRacesLauncher');
  assert.deepEqual(config.build.publish[0], { provider: 'github', owner: 'ilusixn', repo: 'CoACustomRaces-Launcher' });
  assert.equal(config.build.nsis.deleteAppDataOnUninstall, false);
  assert.equal(config.build.nsis.script, 'build/safe-installer.nsi');
  assert.equal(config.build.beforePack, 'tools/production-bundles.cjs');
  assert.equal(config.build.afterSign, 'tools/protected-package.cjs');
  assert.equal(config.build.files.includes('!**/*.map'), true);
  assert.deepEqual(config.build.files.filter(value => typeof value === 'string'), ['package.json', 'launcher.config.json', '!**/*.map']);
  assert.deepEqual(config.build.electronFuses, { runAsNode: false, enableNodeOptionsEnvironmentVariable: false, enableNodeCliInspectArguments: false, enableEmbeddedAsarIntegrityValidation: true, onlyLoadAppFromAsar: true });
});
