const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const nc = require('../src/network-check.cjs');
const { CoaCustom, hostsHere } = require('../src/coa-custom.cjs');
const { sanitize } = require('../src/settings.cjs');

const AUTH = 'C:\\Servers\\coa\\Core\\authserver.exe'; const WORLD = 'C:\\Servers\\coa\\Core\\worldserver.exe';
const ctx = (extra = {}) => ({ authPort: 3724, worldPort: 8085, authExe: AUTH, worldExe: WORLD, running: true, address: '100.100.1.5', dbAddress: '100.100.1.5', mode: 'tailscale', hosting: true, ...extra });
const rule = (extra = {}) => ({ name: 'r', action: 2, profile: 2147483647, protocol: 'TCP', ports: ['Any'], program: 'Any', remote: ['Any'], restricted: false, interfaces: 'All', ...extra });
const on = { profiles: [{ name: 'Domain', enabled: true }, { name: 'Private', enabled: true }, { name: 'Public', enabled: true }] };
// Names are localized on some Windows versions, so only numbers and IPs matter: category 0 Public, 1 Private, 2 Domain.
const tailscale = { alias: 'Réseau Tailscale', category: 0, ips: ['100.100.1.5'] };
const listening = [{ port: 3724, address: '0.0.0.0' }, { port: 8085, address: '0.0.0.0' }];
const find = (result, text) => result.items.find(i => i.name.includes(text));

test('no rule at all: both ports fail and the VPN adapter on a Public network is named', () => {
  const r = nc.evaluate({ ...on, adapters: [tailscale], rules: [], listening }, ctx());
  assert.equal(find(r, 'auth) port 3724').ok, true, 'listening is fine');
  const auth = r.items.find(i => i.name === 'Firewall: Login (auth) port 3724');
  assert.equal(auth.ok, false); assert.match(auth.detail, /Domain, Private, Public/); assert.match(auth.fix, /Allow through Windows Firewall/);
  assert.match(find(r, 'Tailscale').detail, /Public network/); assert.equal(r.firewall.problem, true); assert.equal(r.firewall.installed, false);
});

test('the Windows first-run prompt with only Private ticked leaves Public (the Tailscale network) blocked', () => {
  const r = nc.evaluate({ ...on, adapters: [tailscale], rules: [rule({ profile: 2, ports: ['Any'], program: AUTH }), rule({ profile: 2, program: WORLD })], listening }, ctx());
  const auth = r.items.find(i => i.name === 'Firewall: Login (auth) port 3724');
  assert.equal(auth.ok, false); assert.match(auth.detail, /Domain, Public/); assert.doesNotMatch(auth.detail, /Private/);
});

test('rules for every profile, by port, range or program, count; the other port stays flagged', () => {
  const rules = [rule({ ports: ['3724'] }), rule({ ports: ['8000-8100'], profile: 7 }), rule({ ports: ['Any'], program: WORLD, protocol: 'Any' })];
  const r = nc.evaluate({ ...on, adapters: [tailscale], rules, listening }, ctx());
  assert.equal(r.items.filter(i => i.name.startsWith('Firewall:')).every(i => i.ok === true), true);
  assert.equal(find(r, 'Tailscale').ok, true);
  const udp = nc.evaluate({ ...on, adapters: [], rules: [rule({ protocol: 'UDP', ports: ['3724'] }), rule({ protocol: '6', ports: ['8085'] })], listening }, ctx({ hosting: false }));
  assert.equal(udp.items.find(i => i.name === 'Firewall: Login (auth) port 3724').ok === true, false, 'a UDP rule does not open a TCP port');
  assert.equal(udp.items.find(i => i.name === 'Firewall: World port 8085').ok, true, 'protocol 6 is TCP');
});

test('a block rule beats an allow rule, a remote-address limit is reported, and rules Windows scopes to one app are ignored', () => {
  const blocked = nc.evaluate({ ...on, adapters: [tailscale], listening, rules: [rule({ ports: ['3724'] }), rule({ action: 4, ports: ['3724'], profile: 4 }), rule({ ports: ['8085'], remote: ['LocalSubnet'] })] }, ctx());
  const auth = blocked.items.find(i => i.name === 'Firewall: Login (auth) port 3724'); assert.equal(auth.ok, false); assert.match(auth.detail, /block rule/);
  assert.match(blocked.items.find(i => i.name === 'Firewall: World port 8085').detail, /only for some remote addresses/);
  const ignored = nc.evaluate({ ...on, adapters: [], listening, rules: [rule({ ports: ['3724', '8085'], restricted: true }), rule({ ports: ['Any'] })] }, ctx({ hosting: false }));
  assert.equal(ignored.items.find(i => i.name === 'Firewall: Login (auth) port 3724').ok === true, false);
});

test('with the firewall off nothing is blocked; with one profile off only the active ones need a rule', () => {
  const off = nc.evaluate({ profiles: [{ name: 'Domain', enabled: false }, { name: 'Private', enabled: false }, { name: 'Public', enabled: false }], adapters: [], rules: [], listening }, ctx());
  assert.equal(find(off, 'Windows Firewall').ok, true);
  const part = nc.evaluate({ profiles: [{ name: 'Domain', enabled: false }, { name: 'Private', enabled: true }, { name: 'Public', enabled: false }], adapters: [], listening, rules: [rule({ profile: 2, ports: ['3724'] }), rule({ profile: 2, ports: ['8085'] })] }, ctx());
  assert.equal(part.items.filter(i => i.name.startsWith('Firewall:')).every(i => i.ok === true), true);
});

test('realm address: loopback in the database while the launcher hosts on the VPN is a failure that says where players go', () => {
  const base = { ...on, adapters: [tailscale], rules: [], listening };
  const bad = find(nc.evaluate(base, ctx({ dbAddress: '127.0.0.1' })), 'Realm address');
  assert.equal(bad.ok, false); assert.match(bad.detail, /sent to 127\.0\.0\.1/); assert.match(bad.detail, /their own PC/);
  assert.equal(find(nc.evaluate(base, ctx()), 'Realm address').ok, true);
  const stopped = find(nc.evaluate(base, ctx({ running: false, dbAddress: null })), 'Realm address');
  assert.match(stopped.detail, /will be sent to 100\.100\.1\.5 when the server starts/);
  const local = find(nc.evaluate(base, ctx({ address: '127.0.0.1', dbAddress: '127.0.0.1', mode: 'local' })), 'Realm address');
  assert.equal(local.ok, 'warn'); assert.match(local.detail, /only this PC/);
});

test('sockets bound to 127.0.0.1 are a failure when hosting, a note in local mode, and 0.0.0.0 is fine', () => {
  const loop = [{ port: 3724, address: '127.0.0.1' }, { port: 8085, address: '127.0.0.1' }];
  const hosting = nc.evaluate({ ...on, adapters: [], rules: [], listening: loop }, ctx());
  assert.equal(find(hosting, 'auth) port 3724').ok, false); assert.match(find(hosting, 'auth) port 3724').detail, /only on 127\.0\.0\.1/);
  const local = nc.evaluate({ ...on, adapters: [], rules: [], listening: loop }, ctx({ address: '127.0.0.1', mode: 'local' }));
  assert.equal(find(local, 'auth) port 3724').ok, 'warn');
  assert.equal(find(nc.evaluate({ ...on, adapters: [], rules: [], listening }, ctx()), 'World port 8085').ok, true);
  const down = nc.evaluate({ ...on, adapters: [], rules: [], listening: [] }, ctx({ running: false }));
  assert.equal(find(down, 'auth) port 3724').ok, 'warn');
});

test('program rules left over from another server folder are reported as outdated', () => {
  const stale = rule({ name: 'CoA Custom Races server (authserver.exe)', program: 'D:\\Old\\Core\\authserver.exe' });
  const r = nc.evaluate({ ...on, adapters: [], rules: [stale, rule({ name: 'CoA Custom Races server (auth)', ports: ['3724'] })], listening }, ctx());
  assert.equal(r.firewall.outdated, true); assert.equal(r.firewall.installed, true);
});

test('adapters are recognised by address, not by their (possibly localized) name', () => {
  assert.equal(nc.adapterKind({ alias: 'Réseau', ips: ['100.88.0.1'] }), 'Tailscale');
  assert.equal(nc.adapterKind({ alias: '以太网', ips: ['25.1.2.3'] }), 'Hamachi');
  assert.equal(nc.adapterKind({ alias: 'ZeroTier One [abc]', ips: ['10.147.1.1'] }), 'ZeroTier');
  assert.equal(nc.adapterKind({ alias: 'Ethernet', ips: ['192.168.1.4'] }), '');
});

test('the firewall scripts hold only fixed names and validated ports and paths', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coa-fw-')); fs.mkdirSync(path.join(dir, 'Core'));
  const auth = path.join(dir, 'Core', 'authserver.exe'); const world = path.join(dir, 'Core', 'worldserver.exe'); fs.writeFileSync(auth, ''); fs.writeFileSync(world, '');
  const script = nc.allowScript({ authPort: 3734, worldPort: '8095', authExe: auth, worldExe: world });
  for (const name of Object.values(nc.RULE_NAMES)) assert.ok(script.includes(`'${name}'`));
  assert.match(script, /-LocalPort 3734 -Profile Any/); assert.match(script, /-LocalPort 8095 -Profile Any/); assert.ok(script.includes(`-Program '${auth}'`));
  assert.doesNotMatch(script, /Remove-NetFirewallRule -All|Get-NetFirewallRule \|/, 'never touches other rules');
  assert.match(nc.removeScript(), /Get-NetFirewallRule -DisplayName \$n/);
  assert.throws(() => nc.allowScript({ authPort: '3724; calc', worldPort: 8085, authExe: auth, worldExe: world }), /Invalid auth port/);
  assert.throws(() => nc.allowScript({ authPort: 70000, worldPort: 8085, authExe: auth, worldExe: world }), /Invalid auth port/);
  assert.throws(() => nc.allowScript({ authPort: 1, worldPort: 8085, authExe: dir + '\\Core\\evil.exe', worldExe: world }), /not found/);
  const quote = path.join(dir, "o'reilly"); fs.mkdirSync(path.join(quote, 'Core'), { recursive: true }); fs.writeFileSync(path.join(quote, 'Core', 'authserver.exe'), '');
  assert.throws(() => nc.allowScript({ authPort: 1, worldPort: 2, authExe: path.join(quote, 'Core', 'authserver.exe'), worldExe: world }), /not found/, 'a quote in the path could break out of the script string');
  assert.throws(() => nc.allowScript({ authPort: 1, worldPort: 2, authExe: world, worldExe: world }), /not found/, 'the right program for each rule');
  // The scripts must at least be valid PowerShell (Windows only; the elevated run itself needs a UAC prompt and is not exercised here).
  if (process.platform === 'win32') for (const text of [script, nc.removeScript(), nc.snapshotScript(3724, 8085)]) await nc.powershell(`[void][ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(text).toString('base64')}')))`);
});

test('probe: an open port answers, a closed one and an unknown host are unreachable', async () => {
  const server = net.createServer(socket => socket.end()).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  assert.equal(await nc.probe('127.0.0.1', port, 2000), 'open');
  await new Promise(resolve => server.close(resolve));
  assert.equal(await nc.probe('127.0.0.1', port, 2000), 'unreachable');
  assert.equal(await nc.probe('no-such-host.invalid', 3724, 2000), 'unreachable');
});

test('setBind opens the auth and world servers to every address and closes them again, touching only the BindIP line', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coa-bind-')); fs.mkdirSync(path.join(root, 'Settings'));
  const text = '# BindIP\r\n#    Default: "0.0.0.0"\r\n\r\nBindIP = "127.0.0.1"\r\nRa.IP = "127.0.0.1"\r\nRealmServerPort = @AUTH_PORT@\r\n';
  fs.writeFileSync(path.join(root, 'Settings/authserver.conf.template'), text); fs.writeFileSync(path.join(root, 'Settings/worldserver.conf.template'), text);
  const coa = new CoaCustom({ fetchImpl: async () => ({}), notify: () => {} });
  assert.equal(await coa.setBind(root, true), true);
  const open = fs.readFileSync(path.join(root, 'Settings/worldserver.conf.template'), 'utf8');
  assert.equal(open, text.replace('BindIP = "127.0.0.1"', 'BindIP = "0.0.0.0"'), 'only the setting changed; RA stays on 127.0.0.1; CRLF kept');
  assert.equal(await coa.setBind(root, true), false, 'nothing to do the second time');
  await coa.setBind(root, false); assert.equal(fs.readFileSync(path.join(root, 'Settings/authserver.conf.template'), 'utf8'), text);
  assert.equal(await new CoaCustom({ fetchImpl: async () => ({}), notify: () => {} }).setBind(fs.mkdtempSync(path.join(os.tmpdir(), 'coa-none-')), true), false, 'a folder without templates is left alone');
});

test('hosting: another VPN or a public IP counts only when the player says "I host with this address"', () => {
  const nets = { lan: ['192.168.1.20'], hamachi: [], tailscale: ['100.100.1.5'] };
  assert.equal(hostsHere('custom', '203.0.113.9', nets), false);
  assert.equal(hostsHere('custom', '203.0.113.9', nets, true), true);
  assert.equal(hostsHere('custom', '100.100.1.5', nets), true, 'an address of this PC is recognised without the choice');
  assert.equal(hostsHere('tailscale', '100.100.1.5', nets), true);
  assert.equal(sanitize({ realmHosting: true }).realmHosting, true); assert.equal(sanitize({ realmHosting: 'yes' }).realmHosting, false);
});
