// CoA Custom Races addition to Conquest Launcher (originally developed by Duff (Duff-SPP)); GPL-3.0-only.
// Host-side network checks (can friends reach this server?) and the one-click Windows Firewall fix.
// Everything is read through PowerShell cmdlets and numeric enums, never by parsing localized text.
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const GROUP = 'CoA Custom Races server';
const RULE_NAMES = {
  auth: 'CoA Custom Races server (auth)', world: 'CoA Custom Races server (world)',
  authExe: 'CoA Custom Races server (authserver.exe)', worldExe: 'CoA Custom Races server (worldserver.exe)'
};
const PROFILE = { Domain: 1, Private: 2, Public: 4 }; // NetSecurity profile bit mask; 0 or 0x7fffffff = every profile
const LOOPBACK = /^(127\.|::1$)/;
const EXE_PATH = /^[A-Za-z]:\\[^<>:"/|?*'`$%;&^\r\n]{1,240}\\(authserver|worldserver)\.exe$/i;

const toInt = (value, label) => { const n = Number(value); if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`Invalid ${label}.`); return n; };

// ---- PowerShell plumbing ----
function powershell(script, { timeoutMs = 45000, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('The Windows network query timed out.')); }, timeoutMs);
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`PowerShell failed: ${(err || out).trim().slice(0, 300)}`)); });
  });
}

// Read-only snapshot: firewall profiles, adapter network categories, relevant inbound rules, listening sockets.
function snapshotScript(authPort, worldPort) {
  const a = toInt(authPort, 'auth port'); const w = toInt(worldPort, 'world port');
  return `
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
$ports = @(${a}, ${w})
function InSpec($spec, $p) { foreach ($s in @($spec)) { $t = [string]$s; if ($t -eq 'Any') { return $true }; if ($t -match '^(\\d+)-(\\d+)$') { if ([int]$Matches[1] -le $p -and $p -le [int]$Matches[2]) { return $true } } elseif ($t -eq [string]$p) { return $true } }; return $false }
$result = [ordered]@{}
$result.profiles = @(Get-NetFirewallProfile -PolicyStore ActiveStore | ForEach-Object { [ordered]@{ name = [string]$_.Name; enabled = ([int]$_.Enabled -eq 1) } })
$ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue)
$result.adapters = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue | ForEach-Object { $c = $_; [ordered]@{ alias = [string]$c.InterfaceAlias; category = [int]$c.NetworkCategory; ips = @($ips | Where-Object { $_.InterfaceIndex -eq $c.InterfaceIndex } | ForEach-Object { [string]$_.IPAddress }) } })
# The firewall COM object is readable without administrator rights (the NetSecurity filter cmdlets are not).
$fw = New-Object -ComObject HNetCfg.FwPolicy2
$authExe = $env:COA_AUTH_EXE; $worldExe = $env:COA_WORLD_EXE
$rules = @()
foreach ($r in $fw.Rules) {
  if ($r.Direction -ne 1 -or -not $r.Enabled) { continue }
  $lp = if ($r.LocalPorts) { @(([string]$r.LocalPorts).Split(',') | ForEach-Object { $_.Trim() }) } else { @('Any') }
  $lp = @($lp | ForEach-Object { if ($_ -eq '*') { 'Any' } else { $_ } })
  $program = if ($r.ApplicationName) { [string]$r.ApplicationName } else { 'Any' }
  $ours = ([string]$r.Name).StartsWith('${GROUP}')
  $match = $false; foreach ($port in $ports) { if (InSpec $lp $port) { $match = $true } }
  if (-not ($match -or $ours -or ($program -eq $authExe) -or ($program -eq $worldExe))) { continue }
  $proto = switch ([int]$r.Protocol) { 6 { 'TCP' } 17 { 'UDP' } default { 'Any' } }
  $remote = if ($r.RemoteAddresses) { @(([string]$r.RemoteAddresses).Split(',') | ForEach-Object { $_.Trim() }) } else { @('Any') }
  $restricted = [bool]($r.LocalAppPackageId -or $r.LocalUserAuthorizedList -or $r.ServiceName)
  $rules += [ordered]@{ restricted = $restricted; interfaces = [string]$r.InterfaceTypes; name = [string]$r.Name; action = $(if ([int]$r.Action -eq 1) { 2 } else { 4 }); profile = [int]$r.Profiles; protocol = $proto; ports = $lp; program = $program; remote = $remote }
}
$result.rules = $rules
$result.listening = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ports -contains $_.LocalPort } | ForEach-Object { [ordered]@{ port = [int]$_.LocalPort; address = [string]$_.LocalAddress } })
$result | ConvertTo-Json -Depth 6 -Compress
`;
}
async function snapshot({ authPort, worldPort, authExe = '', worldExe = '' }) {
  const out = await powershell(snapshotScript(authPort, worldPort), { env: { COA_AUTH_EXE: authExe, COA_WORLD_EXE: worldExe } });
  return JSON.parse(out.trim().split(/\r?\n/).pop());
}

// ---- evaluation (pure: a snapshot in, findings out) ----
const arr = value => value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
const same = (a, b) => path.win32.normalize(String(a)).toLowerCase() === path.win32.normalize(String(b)).toLowerCase();
const profileBits = mask => (mask === 0 || mask >= 0x7fffffff) ? 7 : mask & 7;
function portIn(specs, port) {
  return arr(specs).some(spec => {
    const text = String(spec); const range = /^(\d+)-(\d+)$/.exec(text);
    return text === 'Any' || text === String(port) || (range && Number(range[1]) <= port && port <= Number(range[2]));
  });
}
const tcpRule = rule => /^(tcp|6|any)$/i.test(String(rule.protocol));
const remoteOpen = rule => { const r = arr(rule.remote); return (!r.length || r.some(x => /^(any|\*)$/i.test(String(x)))) && /^(all|)$/i.test(String(rule.interfaces || 'All')); };
const categoryName = n => n === 1 ? 'Private' : n === 2 ? 'Domain' : 'Public';
const categoryBit = n => n === 1 ? PROFILE.Private : n === 2 ? PROFILE.Domain : PROFILE.Public;
function adapterKind(adapter) {
  const alias = String(adapter.alias || ''); const ips = arr(adapter.ips);
  if (/tailscale/i.test(alias) || ips.some(ip => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip))) return 'Tailscale';
  if (/hamachi/i.test(alias) || ips.some(ip => ip.startsWith('25.'))) return 'Hamachi';
  if (/zerotier/i.test(alias)) return 'ZeroTier';
  if (/radmin/i.test(alias)) return 'Radmin VPN';
  return '';
}

// Which profiles (bit mask) let TCP `port` in for `exe`? Block rules win over allow rules, as in Windows.
function coverage(rules, port, exe) {
  let allowed = 0; let limited = 0; let blocked = 0;
  for (const rule of rules) {
    if (!tcpRule(rule) || !portIn(rule.ports, port)) continue;
    if (rule.restricted) continue; // limited to one app package, user or Windows service: not a rule for our programs
    const program = String(rule.program || 'Any');
    const forUs = exe && same(program, exe);
    if (!/^any$/i.test(program) && !forUs) continue;
    // A rule for every port of every program is usually an app-package rule Windows does not let us inspect: not counted.
    if (/^any$/i.test(program) && arr(rule.ports).every(p => String(p) === 'Any')) continue;
    const bits = profileBits(Number(rule.profile));
    if (Number(rule.action) === 4) { blocked |= bits; continue; }
    if (remoteOpen(rule)) allowed |= bits; else limited |= bits;
  }
  return { allowed: allowed & ~blocked, limited: limited & ~blocked & ~allowed, blocked };
}
const profileNames = bits => Object.entries(PROFILE).filter(([, bit]) => bits & bit).map(([name]) => name);

function evaluate(snap, ctx) {
  const items = []; const add = (name, ok, detail, fix = '') => items.push({ group: 'Network', name, ok, detail, fix });
  const { authPort, worldPort, authExe, worldExe, running, address, dbAddress, mode, hosting } = ctx;
  const sharing = hosting && address && !LOOPBACK.test(address);
  const adapters = arr(snap.adapters).map(a => ({ ...a, kind: adapterKind(a), ips: arr(a.ips) }));
  const vpns = adapters.filter(a => a.kind);

  // 1. what the auth server tells players to connect to
  if (!hosting) add('Realm address', true, 'This PC is not set up as a host (Join a friend).');
  else if (!running || dbAddress === null || dbAddress === undefined) add('Realm address', !sharing ? 'warn' : true, sharing ? `Players will be sent to ${address} when the server starts.` : 'Local mode: only this PC can connect.', sharing ? '' : 'Realmlist: choose LAN, Hamachi or Tailscale to host for friends.');
  else if (dbAddress === address) add('Realm address', sharing ? true : 'warn', sharing ? `The server hands out ${dbAddress}.` : 'Local mode: the server hands out 127.0.0.1, so only this PC can connect.', sharing ? '' : 'Realmlist: choose LAN, Hamachi or Tailscale to host for friends.');
  else add('Realm address', false, LOOPBACK.test(dbAddress) ? `Players are sent to ${dbAddress}, but the launcher is set to ${address}. They log in, then the realm connection goes to their own PC.` : `Players are sent to ${dbAddress}, but the launcher is set to ${address}.`, 'Realmlist > Save, then restart the server.');

  // 2. listening sockets
  for (const [label, port] of [['Login (auth)', authPort], ['World', worldPort]]) {
    const sockets = arr(snap.listening).filter(s => Number(s.port) === port);
    if (!running && !sockets.length) { add(`${label} port ${port}`, 'warn', 'The server is stopped.', 'Press Start.'); continue; }
    if (!sockets.length) { add(`${label} port ${port}`, false, 'Nothing is listening: the server is not running or failed to start.', 'Press Start and read the server log if it stops.'); continue; }
    const open = sockets.some(s => !LOOPBACK.test(String(s.address)));
    if (open) add(`${label} port ${port}`, true, `Listening on ${sockets.map(s => s.address).join(', ')}.`);
    else add(`${label} port ${port}`, sharing ? false : 'warn', sharing ? 'Listening only on 127.0.0.1, so friends cannot connect.' : 'Listening only on this PC (local mode).', sharing ? 'Restart the server from the launcher: it opens the ports when a friend address is set.' : '');
  }

  // 3. Windows Firewall
  const profiles = Object.fromEntries(arr(snap.profiles).map(p => [p.name, !!p.enabled]));
  const on = Object.entries(PROFILE).filter(([name]) => profiles[name] !== false).map(([, bit]) => bit).reduce((a, b) => a | b, 0);
  const rules = arr(snap.rules).map(r => ({ ...r, ports: arr(r.ports), remote: arr(r.remote) }));
  const ours = rules.filter(r => String(r.name).startsWith(GROUP));
  const authCov = coverage(rules, authPort, authExe); const worldCov = coverage(rules, worldPort, worldExe);
  const firewall = { enabled: on !== 0, installed: ours.length > 0, outdated: false, problem: false };
  if (on === 0) add('Windows Firewall', true, 'The firewall is off for every network type, so it blocks nothing.');
  else {
    for (const [label, port, cov] of [['Login (auth)', authPort, authCov], ['World', worldPort, worldCov]]) {
      const missing = on & ~cov.allowed;
      if (!missing) { add(`Firewall: ${label} port ${port}`, true, `Allowed on ${profileNames(cov.allowed & on).join(', ')} networks.`); continue; }
      firewall.problem = true;
      const where = profileNames(missing).join(', ');
      const detail = cov.blocked & missing ? `No rule lets TCP ${port} in on ${where} networks. A block rule is in the way.` : cov.limited & missing ? `No rule lets TCP ${port} in on ${where} networks. A rule exists but only for some remote addresses.` : `No rule lets TCP ${port} in on ${where} networks.`;
      add(`Firewall: ${label} port ${port}`, vpns.length || sharing ? false : 'warn', detail, 'Press "Allow through Windows Firewall".');
    }
    const stale = ours.filter(r => /\.exe\)$/.test(r.name) && r.program && !(same(r.program, authExe) || same(r.program, worldExe)));
    if (stale.length) { firewall.outdated = true; add('Firewall rules of this launcher', 'warn', 'The program rules point to a server folder that is no longer this one.', 'Press "Allow through Windows Firewall" again.'); }
  }

  // 4. adapters and their network type
  if (!adapters.length) add('Network adapters', 'warn', 'Windows reported no connected network.');
  for (const a of (vpns.length ? vpns : [])) {
    const category = categoryName(a.category);
    const covered = !!(authCov.allowed & worldCov.allowed & categoryBit(a.category));
    add(`${a.kind} (${a.ips.join(', ') || a.alias})`, covered || on === 0 ? true : 'warn', on !== 0 && !covered ? `Windows treats this network as ${category}. Ports ${authPort} and ${worldPort} are not allowed on ${category} networks.` : `Windows treats this network as ${category}.`, covered || on === 0 ? '' : 'Press "Allow through Windows Firewall".');
  }
  if (sharing && !vpns.some(v => v.ips.includes(address)) && !adapters.some(a => a.ips.includes(address))) add('Address on this PC', 'warn', `${address} is not an address of this PC's adapters. That is fine for a public IP or DNS name behind a router, but the router must forward TCP ${authPort} and ${worldPort} to this PC.`, mode === 'custom' ? '' : 'Check that the VPN is connected.');
  return { items, firewall, adapters, listening: arr(snap.listening) };
}

// ---- the elevated fix (data is validated, the command line carries only the encoded script) ----
function checkedExe(file, expected) {
  const full = path.win32.normalize(String(file));
  if (!EXE_PATH.test(full) || path.win32.basename(full).toLowerCase() !== expected || !fs.existsSync(full)) throw new Error(`${expected} was not found in the server folder.`);
  return full;
}
function allowScript({ authPort, worldPort, authExe, worldExe }) {
  const a = toInt(authPort, 'auth port'); const w = toInt(worldPort, 'world port');
  const auth = checkedExe(authExe, 'authserver.exe'); const world = checkedExe(worldExe, 'worldserver.exe');
  return `$ErrorActionPreference = 'Stop'
try {
  $group = '${GROUP}'
  $names = @('${RULE_NAMES.auth}', '${RULE_NAMES.world}', '${RULE_NAMES.authExe}', '${RULE_NAMES.worldExe}')
  foreach ($n in $names) { Get-NetFirewallRule -DisplayName $n -ErrorAction SilentlyContinue | Remove-NetFirewallRule }
  New-NetFirewallRule -DisplayName $names[0] -Group $group -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${a} -Profile Any | Out-Null
  New-NetFirewallRule -DisplayName $names[1] -Group $group -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${w} -Profile Any | Out-Null
  New-NetFirewallRule -DisplayName $names[2] -Group $group -Direction Inbound -Action Allow -Protocol TCP -Program '${auth}' -Profile Any | Out-Null
  New-NetFirewallRule -DisplayName $names[3] -Group $group -Direction Inbound -Action Allow -Protocol TCP -Program '${world}' -Profile Any | Out-Null
  exit 0
} catch { exit 2 }
`;
}
function removeScript() {
  return `$ErrorActionPreference = 'Stop'
try {
  foreach ($n in @('${RULE_NAMES.auth}', '${RULE_NAMES.world}', '${RULE_NAMES.authExe}', '${RULE_NAMES.worldExe}')) { Get-NetFirewallRule -DisplayName $n -ErrorAction SilentlyContinue | Remove-NetFirewallRule }
  exit 0
} catch { exit 2 }
`;
}
// Runs `script` in a UAC-elevated PowerShell. Returns { ok, declined, code }. Declining UAC changes nothing.
function elevate(script, { timeoutMs = 120000 } = {}) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64'); // base64 has no quote or shell characters
  const outer = `try { $p = Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}'; exit $p.ExitCode } catch { exit 1223 }`;
  return new Promise(resolve => {
    const child = spawn(path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(outer, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill(); resolve({ ok: false, declined: false, code: -1 }); }, timeoutMs);
    child.on('error', () => { clearTimeout(timer); resolve({ ok: false, declined: false, code: -1 }); });
    child.on('close', code => { clearTimeout(timer); resolve({ ok: code === 0, declined: code === 1223, code }); });
  });
}

// ---- joiner side: does anything answer at the host's login port? ----
// 'open' | 'unreachable' | 'unknown' (anything we cannot judge never blocks Play)
function probe(host, port, timeoutMs = 3000) {
  return new Promise(resolve => {
    const socket = net.connect({ host, port });
    const done = result => { socket.destroy(); resolve(result); };
    socket.setTimeout(timeoutMs, () => done('unreachable'));
    socket.on('connect', () => done('open'));
    socket.on('error', error => done(['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN'].includes(error.code) ? 'unreachable' : 'unknown'));
  });
}

module.exports = { GROUP, RULE_NAMES, snapshot, snapshotScript, evaluate, coverage, adapterKind, allowScript, removeScript, elevate, probe, powershell, EXE_PATH };
