// CoA Custom Races addition to Conquest Launcher (originally developed by Duff (Duff-SPP)); GPL-3.0-only.
// Runs the SquidBots dashboard by Zyth45 (MIT, https://github.com/Zyth45/squidbots-dashboard) beside a local server:
// it is downloaded at a PINNED tag into <server>/Extras/SquidBotsDashboard, started with the server's own Python on a
// free 127.0.0.1 port while the server runs, and shown inside the launcher. It only reads the game database.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const REPOSITORY = 'Zyth45/squidbots-dashboard';
// v3.1.0 is the dashboard "for CoA Bots 3.1": the playerbots module this server ships (v3.1.x) writes the files it reads.
// The hashes pin the code: a tag that was moved or tampered with is refused.
const PIN = {
  tag: 'v3.1.0', version: '3.1.0',
  files: {
    'squidbots.py': '98ad9cc3a59a26513dd0e5987614caa00973bbb5c5df0da1eb335ca8902def71',
    'botconfig.py': '1189db170701e9afbf7f10f6e873f95e079ccce1092dafccc423f7d3bf9138bb',
    'index.html': 'ad603ef34b2a941eaf9f33925f78660bc15eda38e078d009f48f544e5382e528',
    'static/dashboard.js': '6ee336702f863ed3b208ff220dc52b2ca4a38ec9302348636277c1101e5d3ba3'
  }
};
const FOLDER = 'Extras/SquidBotsDashboard';
const NOTICE = `SquidBots dashboard - notice

The dashboard in this folder is SquidBots by Zyth45 (https://github.com/Zyth45/squidbots-dashboard), tag ${PIN.tag}, MIT licence
(see LICENSE in this folder). The CoA Custom Races launcher downloads it unchanged, writes dashboard.json for this server, runs it
with the server's own Python on a free 127.0.0.1 port while the server runs, and shows it in its Bots page.
It reads the game database and the worldserver logs; it does not write to the game database.
Thank you Zyth45 (and Sass42, who built its pages and maps).
`;

const sha256 = async file => crypto.createHash('sha256').update(await fsp.readFile(file)).digest('hex');
const semver = tag => tag.replace(/^v/, '').split('.').map(n => Number(n) || 0);
const newer = (a, b) => { const x = semver(a); const y = semver(b); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };

function freePort(start = 18088) {
  return new Promise(resolve => {
    const probe = port => {
      const server = net.createServer();
      server.once('error', () => probe(port + 1));
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(port)));
    };
    probe(start);
  });
}
function ping(port) {
  return new Promise(resolve => {
    const request = http.get({ host: '127.0.0.1', port, path: '/', timeout: 2000 }, response => { response.resume(); resolve(response.statusCode === 200); });
    request.on('error', () => resolve(false)); request.on('timeout', () => { request.destroy(); resolve(false); });
  });
}

class SquidDashboard {
  // coa: the CoaCustom instance (download, tar, setConf, readConf, dbReady).
  constructor({ coa, python = '' }) { this.coa = coa; this.child = null; this.port = 0; this.root = ''; this.starting = null; this.lastError = ''; this.python = python; }

  dir(root) { return path.join(root, FOLDER); }

  async installedVersion(root) {
    return (await fsp.readFile(path.join(this.dir(root), 'VERSION'), 'utf8').catch(() => '')).trim() || '';
  }

  // The newest v* tag of the repository (information only: the launcher installs the pinned one).
  async newestTag() {
    try {
      const response = await this.coa.fetch(`https://api.github.com/repos/${REPOSITORY}/tags?per_page=50`, { headers: { Accept: 'application/vnd.github+json' } });
      if (!response.ok) return '';
      const tags = (await response.json()).map(t => t.name).filter(n => /^v\d+(\.\d+)*$/.test(n));
      return tags.reduce((best, tag) => (!best || newer(tag, best) ? tag : best), '');
    } catch { return ''; }
  }

  async info(root) {
    const installed = await this.installedVersion(root);
    return { installed, pinned: PIN.version, pinnedTag: PIN.tag, updateAvailable: !!installed && installed !== PIN.version, running: this.isRunning(root), port: this.isRunning(root) ? this.port : 0,
      url: this.isRunning(root) ? `http://127.0.0.1:${this.port}/` : '', error: this.lastError };
  }

  isRunning(root) { return !!this.child && this.child.exitCode === null && (!root || this.root === root); }

  async install(root) {
    await this.stop();
    const work = await fsp.mkdtemp(path.join(this.coa.tmpDir(), 'dashboard-'));
    try {
      const archive = await this.coa.download(`https://codeload.github.com/${REPOSITORY}/tar.gz/refs/tags/${PIN.tag}`, path.join(work, 'dashboard.tgz'), { label: `SquidBots dashboard ${PIN.tag}` });
      const out = path.join(work, 'out');
      await fsp.mkdir(out, { recursive: true });
      await this.coa.tar(['-xzf', archive, '-C', out, '--strip-components=1']);
      for (const [file, digest] of Object.entries(PIN.files)) {
        if ((await sha256(path.join(out, file)).catch(() => '')) !== digest) throw new Error(`The SquidBots dashboard download does not match ${PIN.tag} (${file}). It was not installed.`);
      }
      await fsp.rm(path.join(out, 'docs'), { recursive: true, force: true }); // screenshots only
      const target = this.dir(root);
      // shortcut: files of an older version that this tag dropped stay; its own state files (history, baseline) are kept on purpose.
      await fsp.cp(out, target, { recursive: true, force: true });
      await fsp.writeFile(path.join(target, 'LAUNCHER-NOTICE.txt'), NOTICE);
    } finally { await fsp.rm(work, { recursive: true, force: true }); }
    const notes = await this.configure(root);
    return { version: await this.installedVersion(root), notes };
  }

  // dashboard.json from the server's own settings, plus the module's live status file when its config knows the option.
  async configure(root) {
    const notes = [];
    const logs = path.join(root, 'Core/Logs').replace(/\\/g, '/');
    const settings = {
      repack: root.replace(/\\/g, '/'),
      coaLog: `${logs}/CoaBots.log`, chatLog: `${logs}/Chat.log`, lootLog: `${logs}/BotLoot.log`, botStatusFile: `${logs}/bot-status.json`,
      crashesDir: path.join(root, 'Core/Crashes').replace(/\\/g, '/'),
      settingsPage: false, gmTools: false, realms: false, webIcons: false
    };
    await fsp.writeFile(path.join(this.dir(root), 'dashboard.json'), JSON.stringify(settings, null, 2));
    const supported = (await this.coa.readConf(root, 'playerbots.conf', 'AiPlayerbot.CoaStatusFile')) !== null;
    if (supported) {
      const current = await this.coa.readConf(root, 'playerbots.conf', 'AiPlayerbot.CoaStatusFile');
      if (!current) {
        await this.coa.setConf(root, 'playerbots.conf', 'AiPlayerbot.CoaStatusFile', `"${logs}/bot-status.json"`);
        await this.coa.setConf(root, 'playerbots.conf', 'AiPlayerbot.CoaStatusIntervalSeconds', 5);
        notes.push('Live bot positions are switched on: restart the server to apply.');
      }
    } else notes.push('This server\'s bots module has no live status file: the dashboard uses the last character save.');
    return notes;
  }

  // Starts the dashboard for a running server; resolves with its URL.
  async start(root) {
    if (this.isRunning(root)) return `http://127.0.0.1:${this.port}/`;
    if (this.starting) return this.starting;
    this.starting = this.launch(root).finally(() => { this.starting = null; });
    return this.starting;
  }

  async launch(root) {
    const dir = this.dir(root);
    if (!(await this.installedVersion(root))) throw new Error('The SquidBots dashboard is not installed.');
    if (!(await this.coa.dbReady(root))) throw new Error('Start the server first: the dashboard reads its database.');
    const python = this.python || path.join(root, 'Runtime/python/python.exe');
    if (!fs.existsSync(python)) throw new Error('The server has no bundled Python (Runtime/python).');
    await this.configure(root).catch(() => {});
    await this.stop();
    const port = await freePort();
    this.lastError = '';
    let output = '';
    const child = spawn(python, ['-B', 'squidbots.py'], { cwd: dir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, COA_DASHBOARD_PORT: String(port), PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' } });
    child.stdout.on('data', d => { output = (output + d).slice(-2000); });
    child.stderr.on('data', d => { output = (output + d).slice(-2000); });
    child.on('exit', () => { if (this.child === child) this.child = null; });
    child.on('error', error => { this.lastError = error.message; });
    this.child = child; this.port = port; this.root = root;
    for (let i = 0; i < 60; i++) {
      if (child.exitCode !== null) break;
      if (await ping(port)) return `http://127.0.0.1:${port}/`;
      await new Promise(r => setTimeout(r, 500));
    }
    this.lastError = (output.trim().split(/\r?\n/).slice(-3).join(' ') || 'The dashboard did not answer.').slice(0, 300);
    await this.stop();
    throw new Error(`The SquidBots dashboard did not start: ${this.lastError}`);
  }

  // For app quit, where nothing can be awaited.
  stopSync() {
    const child = this.child; this.child = null;
    if (!child || child.exitCode !== null) return;
    try { require('node:child_process').spawnSync(path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }); } catch { try { child.kill(); } catch {} }
  }

  async stop() {
    const child = this.child; this.child = null;
    if (!child || child.exitCode !== null) return;
    await new Promise(resolve => {
      const kill = spawn(path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      kill.on('error', () => { try { child.kill(); } catch {} resolve(); });
      kill.on('close', () => resolve());
    });
  }
}

module.exports = { SquidDashboard, PIN, REPOSITORY, FOLDER, newer, freePort };
