const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { launchGame } = require('../src/game-launch.cjs');

function child(pid = 4321) {
  const value = new EventEmitter();
  value.pid = pid;
  value.unrefCalls = 0;
  value.unref = () => { value.unrefCalls++; };
  return value;
}

test('launches Ascension directly as an independent process', async () => {
  const executable = "C:\\Games\\Player's $client & test\\Ascension.exe";
  const started = child();
  let handedOff = 0;

  const pending = launchGame(executable, {
    spawnProcess(file, args, options) {
      assert.equal(file, executable);
      assert.deepEqual(args, []);
      assert.equal(options.cwd, "C:\\Games\\Player's $client & test");
      assert.equal(options.shell, false);
      assert.equal(options.detached, true);
      assert.equal(options.stdio, 'ignore');
      assert.equal(options.windowsHide, false);
      process.nextTick(() => started.emit('spawn'));
      return started;
    },
    onLaunched() { handedOff++; }
  });

  assert.equal(await pending, 4321);
  assert.equal(started.unrefCalls, 1);
  assert.equal(handedOff, 1);
});

test('reports a direct spawn failure without invoking a shell helper', async () => {
  const started = child();
  const pending = launchGame('C:\\Game\\Ascension.exe', {
    spawnProcess(file) {
      assert.equal(file, 'C:\\Game\\Ascension.exe');
      process.nextTick(() => started.emit('error', new Error('Access denied')));
      return started;
    },
    onLaunched() { assert.fail('handoff must not run after a failed spawn'); }
  });
  await assert.rejects(pending, /Access denied/);
});

test('HD disabled passes two literal arguments; enabled preserves the normal launch', async () => {
  for (const hdPatches of [false, true]) {
    const started = child();
    const pending = launchGame('C:\\Game\\Ascension.exe', {
      hdPatches,
      spawnProcess(file, args, options) {
        assert.equal(file, 'C:\\Game\\Ascension.exe');
        assert.deepEqual(args, hdPatches ? [] : ['-hd', '0']);
        assert.equal(options.shell, false);
        process.nextTick(() => started.emit('spawn'));
        return started;
      },
      onLaunched() {}
    });
    assert.equal(await pending, 4321);
  }
});

test('rejects invalid executable paths and invalid process ids', async () => {
  assert.throws(() => launchGame('Ascension.exe'), /valid absolute game executable path/);
  assert.throws(() => launchGame('C:\\Game\\Ascension.txt'), /valid absolute game executable path/);

  const started = child(0);
  const pending = launchGame('C:\\Game\\Ascension.exe', {
    spawnProcess() {
      process.nextTick(() => started.emit('spawn'));
      return started;
    },
    onLaunched() { assert.fail('handoff must not run for an invalid pid'); }
  });
  await assert.rejects(pending, /no game process/i);
  assert.equal(started.unrefCalls, 0);
});

test('launcher handoff obeys close, minimize and keep-open preferences', () => {
  const { applyLauncherLaunchBehavior } = require('../src/game-launch.cjs');
  let closed=0,minimized=0,scheduled=0;
  const actions={quit:()=>closed++,minimize:()=>minimized++,schedule:(action,ms)=>{assert.equal(ms,250);scheduled++;action();}};
  applyLauncherLaunchBehavior('keep-open',actions);assert.equal(closed,0);assert.equal(minimized,0);
  applyLauncherLaunchBehavior('minimize',actions);assert.equal(minimized,1);assert.equal(closed,0);
  applyLauncherLaunchBehavior('close',actions);assert.equal(closed,1);assert.equal(scheduled,1);
  const {sanitize}=require('../src/settings.cjs');
  assert.equal(sanitize({launchBehavior:'invalid'}).launchBehavior,'keep-open');
  assert.equal(sanitize({launchBehavior:'close'}).launchBehavior,'keep-open'); // old default migrates once
  assert.equal(sanitize({launchBehavior:'close',launchBehaviorMigrated:true}).launchBehavior,'close'); // a later explicit choice stays
  assert.equal(sanitize({launchBehavior:'keep-open'}).launchBehavior,'keep-open');
});
