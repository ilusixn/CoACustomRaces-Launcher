const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { Portal } = require('../src/portal.cjs');
const { launchGame } = require('../src/game-launch.cjs');
const { defaults, sanitize, saveSettings, readSettings } = require('../src/settings.cjs');

function fixture(options = {}) {
  const state = { loginStatus: 200, sessionStatus: 200, logoutStatus: 200 };
  const portal = new Portal('https://launcher.example/', { ...options, fetchImpl: async url => {
    if (url.pathname === '/api/site-config') return new Response('{}');
    if (url.pathname === '/api/auth/login') return new Response('{}', { status: state.loginStatus, headers: { 'Set-Cookie': 'coa_portal=session-only; Path=/' } });
    if (url.pathname === '/api/auth/logout') return new Response('{}', { status: state.logoutStatus });
    return new Response(JSON.stringify({ username: 'PLAYER', accountId: 1 }), { status: state.sessionStatus });
  } });
  return { portal, state };
}

test('failed sign-in, session expiry and logout clear retained game credentials', async () => {
  const { portal, state } = fixture();
  const signIn = () => portal.login('player@example.com', 'test-only-secret', { rememberForGame: true });
  await signIn();
  state.loginStatus = 401;
  await assert.rejects(signIn());
  assert.equal(portal.getGameLogin(), null);
  state.loginStatus = 200;
  await signIn();
  state.sessionStatus = 401;
  assert.equal(await portal.account(), null);
  assert.equal(portal.getGameLogin(), null);
  state.sessionStatus = 200;
  await signIn();
  state.logoutStatus = 500;
  await assert.rejects(portal.logout());
  assert.equal(portal.getGameLogin(), null);
});

test('disabling while sign-in is in flight prevents credentials being retained later', async () => {
  let finish;
  const portal = new Portal('https://launcher.example/', { fetchImpl: async url => {
    if (url.pathname === '/api/site-config') return new Response('{}');
    if (url.pathname === '/api/auth/login') return new Promise(resolve => { finish = () => resolve(new Response('{}')); });
    return new Response('{"username":"PLAYER"}');
  } });
  const pending = portal.login('player', 'test-only-secret', { rememberForGame: true });
  await new Promise(setImmediate);
  portal.clearGameLogin();
  finish(); await pending;
  assert.equal(portal.getGameLogin(), null);
});

test('client receives verified literal login arguments and HD preference without shell interpolation', async () => {
  const password = 'test "quote" \\ &';
  const child = new EventEmitter(); child.pid = 1234; child.unref = () => {};
  const pid = await launchGame('C:\\Game\\Ascension.exe', {
    hdPatches: false, getAutoLogin: () => ({ username: 'PLAYER', password }), onLaunched() {},
    spawnProcess: (file, args, options) => {
      assert.equal(file, 'C:\\Game\\Ascension.exe');
      assert.deepEqual(args, ['-hd', '0', '--login', 'PLAYER', '--password', password, '--autologin', '1']);
      assert.equal(options.shell, false);
      process.nextTick(() => child.emit('spawn'));
      return child;
    }
  });
  assert.equal(pid, 1234);
});

test('synchronous and asynchronous launch errors never expose credentials or full launch arguments', async () => {
  const password = 'test-only-secret';
  for (const asynchronous of [false, true]) {
    await assert.rejects(launchGame('C:\\Game\\Ascension.exe', {
      getAutoLogin: () => ({ username: 'PLAYER', password }), onLaunched() {},
      spawnProcess: () => {
        const error = new Error(`command --password ${password}`);
        if (!asynchronous) throw error;
        const child = new EventEmitter();
        process.nextTick(() => child.emit('error', error));
        return child;
      }
    }), error => !error.message.includes(password) && !error.message.includes('--password'));
  }
});

