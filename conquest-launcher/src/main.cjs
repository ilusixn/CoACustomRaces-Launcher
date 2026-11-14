// Copyright (C) 2026 Duff (Duff-SPP). GPL-3.0-only; see LICENSE and ATTRIBUTION.md at the repository root.
const { app, BrowserWindow, WebContentsView, ipcMain, dialog, shell, protocol, net, session, safeStorage, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { launchGame, applyLauncherLaunchBehavior } = require('./game-launch.cjs');
const { pathToFileURL } = require('node:url');
const { readSettings, saveSettings, externalUrl } = require('./settings.cjs');
const { translateNative } = require('./launcher-language.cjs');
const nativeText = text => translateNative(settings?.language || 'en', text);
const { AddonService } = require('./addons.cjs');
const config = require('../launcher.config.json');
const { ClientUpdater } = require('./client-updater.cjs');
const { safePath } = require('./release-format.cjs');
const { validateClientFolder, probeClientFolder } = require('./client-folder.cjs');
const { clearClientCache } = require('./client-cache.cjs');
const { configureClientGraphics } = require('./client-graphics.cjs');
const { Portal } = require('./portal.cjs');
const { GameCredentials } = require('./game-credentials.cjs');
const { requireGameClosed, isGameRunning, configureRealm } = require('./game-safety.cjs');
const { createLauncherUpdates } = require('./launcher-updates.cjs');
const { CoaCustom, networkAddresses, hostnameOk } = require('./coa-custom.cjs');
const localTesting = !app.isPackaged && process.env.COA_LOCAL_TEST === '1';
const electronFetch = (input, init) => net.fetch(input, init);
config.localDownloadDemo = localTesting && process.env.COA_DOWNLOAD_DEMO === '1';
if (localTesting) {
  app.setPath('userData', path.join(app.getPath('appData'), 'ConquestLauncher-LocalTest'));
  config.apiBaseUrl = 'http://127.0.0.1:5082/';
  config.manifestUrl = 'http://127.0.0.1:5082/downloads/client/latest.json';
  config.links.account = 'http://127.0.0.1:5082/#account';
  config.links.register = 'http://127.0.0.1:5082/#register';
  config.realmlist = '127.0.0.1';
}
function writableClient(directory) {
  if (!directory) return;

  const target = path.resolve(directory).toLowerCase();
  const launcherRoot = path.resolve(
    app.isPackaged ? path.dirname(app.getPath('exe')) : path.join(__dirname, '..')
  ).toLowerCase();

  // A dedicated client subfolder is safe; Electron/runtime directories are not.
  const relative = path.relative(launcherRoot, target);
  if (relative && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)) {
    const branch = relative.split(path.sep)[0];
    if (['resources', 'locales', 'swiftshader', 'src', 'public', 'node_modules', 'build', 'tools', 'test', 'localization', '.git', '.coa-launcher'].includes(branch)) {
      throw new Error('Choose a dedicated client subfolder, not a launcher runtime folder.');
    }
  }

  if (
    target === path.parse(target).root ||
    target === launcherRoot ||
    launcherRoot.startsWith(target + path.sep)
  ) {
    throw new Error('Choose a dedicated client folder outside the launcher installation.');
  }
}

app.setName('CoA Custom Races');
if (process.platform === 'win32') app.setAppUserModelId('com.ilusixn.coacustomraces.launcher');
protocol.registerSchemesAsPrivileged([{ scheme: 'conquest', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let window = null;
let settings = null;
let settingsFile = '';
let game = null;
const embeddedViews = new Map();
let saveQueue = Promise.resolve();
let issueCache = { loadedAt: 0, issues: [] };
let addonService = null;
let clientUpdater = null;
let launcherUpdates = null;
let portal = null;
let gameCredentials = null;
app.on('before-quit', () => portal?.clearGameLogin());
let clientMutation = false;
async function requireIdleClient(validatePath = true) {
  if (validatePath) writableClient(settings?.installPath);
  if (clientUpdater?.busy || clientMutation) throw new Error('Wait for the current client operation to finish.');
  if (game) throw new Error('Close the game before changing client files.');
  await requireGameClosed(settings?.installPath);
}
async function chooseClientFolder() {
  await requireIdleClient(false);
  const result = await dialog.showOpenDialog(window, { title: nativeText('Choose a game folder: empty or already installed'), properties: ['openDirectory', 'createDirectory'], defaultPath: settings.installPath || app.getPath('documents') });
  if (result.canceled || !result.filePaths[0]) return null;
  // The dialog is asynchronous; recheck before saving a changed destination.
  await requireIdleClient(false);
  const directory = path.resolve(result.filePaths[0]);
  writableClient(directory);
  await requireGameClosed(directory);
  const forbidden = [path.parse(directory).root, app.getPath('home'), app.getPath('documents'), app.getPath('desktop'), path.dirname(app.getPath('exe')), process.env.WINDIR, process.env.ProgramFiles, process.env['ProgramFiles(x86)']];
  await validateClientFolder(directory, config.clientExecutable, forbidden);
  await requireIdleClient(false);
  await persist({ ...settings, installPath: directory });
  clientUpdater.emit('idle', 'Game folder selected. Ready to check the client.');
  return clientInfo();
}
async function mutateClient(action) {
  writableClient(settings?.installPath);
  if (clientUpdater?.busy || clientMutation) throw new Error('Wait for the current client operation to finish.');
  clientMutation = true;
  try { await requireGameClosed(settings?.installPath); return await action(); } finally { clientMutation = false; }
}
function sendStatus(channel, status) { if (window && !window.isDestroyed()) window.webContents.send(channel, status); }
const publicRoot = path.resolve(__dirname, '../public');
const updateTaskbarBadge = require('./taskbar-badge.cjs').createTaskbarBadge(() => window, nativeImage, path.join(publicRoot, 'assets'));
const appUrl = 'conquest://launcher/index.html';
const issueCacheMs = 2 * 60 * 1000;

function trustedHttps(value, label) {
  if (typeof value !== 'string' || !value) throw new Error(`${label} is not configured.`);
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`${label} must use HTTPS.`);
  return url;
}

function bugRepository() {
  const repository = config.bugtracker?.repository;
  if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('The bugtracker repository is not configured correctly.');
  }
  return repository;
}

function handle(name, action) {
  ipcMain.handle(name, async (event, ...args) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== appUrl) {
      throw new Error('Untrusted launcher request.');
    }
    try {
      // CoA Custom Races edition: own server, LAN or Hamachi only, no account sign-in.
      return { ok: true, value: await action(...args) };
    }
    catch (error) { return { ok: false, error: error.message || 'The request could not be completed.' }; }
  });
}

function persist(next) {
  const pending = saveQueue.then(async () => { settings = await saveSettings(settingsFile, next); return settings; });
  saveQueue = pending.catch(() => {});
  return pending;
}

async function clientInfo() {
  const directory = settings?.installPath;
  if (!directory) return { installed: false, running: !!game, path: '' };
  let running = !!game;
  let detectionError = '';
  try { running ||= await isGameRunning(directory); } catch (error) { detectionError = error.message; }
  const executable = path.join(directory, path.basename(config.clientExecutable));
  const customReady = await fs.stat(path.join(directory, 'CoACustomRace.exe')).then(s => s.isFile()).catch(() => false);
  let folderAvailable = false;
  try {
    folderAvailable = (await fs.stat(directory)).isDirectory();
    const stat = await fs.stat(executable);
    return { installed: stat.isFile(), addonsReady: stat.isFile() || localTesting, running, detectionError, path: directory, customReady, executable: 'CoACustomRace.exe' };
  } catch (error) {
    return { installed: false, addonsReady: localTesting && folderAvailable && error.code === 'ENOENT', running, detectionError, path: directory, error: error.code === 'ENOENT' ? '' : `Client folder is unavailable: ${error.message}` };
  }
}

function sendDatabaseStatus(state, message = '', page = 'database') {
  if (!window || window.isDestroyed()) return;
  window.webContents.send('launcher:database-status', { state, message, page });
}

function openSafeExternal(value) {
  const url = trustedHttps(value, 'External link');
  return shell.openExternal(url.href);
}

function ensureDatabaseView(page = 'database') {
  if (page !== 'database' && page !== 'armory') throw new Error('Unknown embedded page.');
  let databaseView = embeddedViews.get(page);
  if (databaseView && !databaseView.webContents.isDestroyed()) return databaseView;
  if (!window) throw new Error('Launcher window is not ready.');

  const target = trustedHttps(page === 'armory' ? config.links?.armory : config.databaseEmbedUrl || config.links?.database, 'Embedded page URL');
  const targetOrigin = target.origin;
  const partition = `coa-${page}`;
  const databaseSession = session.fromPartition(partition);
  databaseSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  databaseSession.setPermissionCheckHandler(() => false);

  databaseView = new WebContentsView({
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    }
  });
  databaseView.setVisible(false);
  databaseView.setBackgroundColor('#160e0d');
  databaseView.setBorderRadius(8);
  window.contentView.addChildView(databaseView);
  embeddedViews.set(page, databaseView);

  const contents = databaseView.webContents;
  contents.setWindowOpenHandler(details => {
    try {
      const url = trustedHttps(details.url, 'Database link');
      if (url.origin === targetOrigin) setImmediate(() => contents.loadURL(url.href).catch(() => {}));
      else setImmediate(() => openSafeExternal(url.href).catch(() => {}));
    } catch {}
    return { action: 'deny' };
  });
  contents.on('will-navigate', event => {
    let next;
    try { next = trustedHttps(event.url, 'Database link'); }
    catch { event.preventDefault(); return; }
    if (next.origin !== targetOrigin) {
      event.preventDefault();
      openSafeExternal(next.href).catch(() => {});
    }
  });
  let failed = false;
  contents.on('did-start-loading', () => { failed = false; sendDatabaseStatus('loading', '', page); });
  contents.on('did-stop-loading', () => { if (!failed) sendDatabaseStatus('ready', '', page); });
  contents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) { failed = true; sendDatabaseStatus('error', errorDescription || 'Embedded page could not be loaded.', page); }
  });
  contents.loadURL(target.href).catch(error => { failed = true; sendDatabaseStatus('error', error.message, page); });
  return databaseView;
}

function databaseBounds(bounds) {
  if (!window || !bounds || typeof bounds !== 'object') throw new Error('Invalid database bounds.');
  const values = ['x', 'y', 'width', 'height'].map(key => Number(bounds[key]));
  if (values.some(value => !Number.isFinite(value))) throw new Error('Invalid database bounds.');
  const [x, y, width, height] = values.map(Math.round);
  const area = window.getContentBounds();
  const left = Math.max(0, Math.min(x, area.width - 1));
  const top = Math.max(0, Math.min(y, area.height - 1));
  const right = Math.max(left + 1, Math.min(x + width, area.width));
  const bottom = Math.max(top + 1, Math.min(y + height, area.height));
  if (right - left < 100 || bottom - top < 100) throw new Error('Database view is too small.');
  return { x: left, y: top, width: right - left, height: bottom - top };
}

async function readIssues(force = false) {
  const now = Date.now();
  const maxAge = force ? 15 * 1000 : issueCacheMs;
  if (issueCache.issues.length && now - issueCache.loadedAt < maxAge) return issueCache.issues;

  const repository = bugRepository();
  const api = `https://api.github.com/repos/${repository}/issues?state=open&sort=updated&direction=desc&per_page=100`;
  let response;
  try {
    response = await net.fetch(api, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Conquest-of-AzerothCore-Launcher',
        'X-GitHub-Api-Version': '2026-03-10',
      },
    });
  } catch (error) {
    if (issueCache.issues.length) return issueCache.issues;
    throw new Error(`Could not reach GitHub: ${error.message}`);
  }

  if (!response.ok) {
    if (issueCache.issues.length) return issueCache.issues;
    if (response.status === 403 || response.status === 429) throw new Error('GitHub is temporarily rate limiting issue requests. Try again shortly.');
    throw new Error(`GitHub returned HTTP ${response.status}.`);
  }

  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('GitHub returned an unexpected issue response.');
  const issues = [];
  for (const issue of data) {
    if (!issue || typeof issue !== 'object' || issue.pull_request) continue;
    if (!Number.isInteger(issue.number) || typeof issue.title !== 'string') continue;
    issues.push({
      number: issue.number,
      title: issue.title.slice(0, 500),
      body: typeof issue.body === 'string' ? issue.body.slice(0, 20000) : '',
      state: issue.state === 'closed' ? 'closed' : 'open',
      stateReason: typeof issue.state_reason === 'string' ? issue.state_reason : '',
      updatedAt: typeof issue.updated_at === 'string' ? issue.updated_at : '',
      createdAt: typeof issue.created_at === 'string' ? issue.created_at : '',
      author: typeof issue.user?.login === 'string' ? issue.user.login : '',
      comments: Number.isInteger(issue.comments) ? issue.comments : 0,
      labels: Array.isArray(issue.labels) ? issue.labels.map(label => typeof label === 'string' ? label : label?.name).filter(name => typeof name === 'string').slice(0, 12) : [],
    });
  }
  issueCache = { loadedAt: now, issues };
  return issues;
}

function reportBody(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw new Error('Invalid bug report.');
  const text = key => typeof report[key] === 'string' ? report[key].replace(/\r\n/g, '\n').trim() : '';
  const title = text('title');
  const category = text('category');
  const severity = text('severity');
  const issue = text('issue');
  const expected = text('expected');
  const actual = text('actual');
  const steps = text('steps');
  const allowedCategories = new Set(['Gameplay', 'Class / Spell', 'Quest', 'Item', 'Creature / NPC', 'Dungeon / Raid', 'UI / Addon', 'Performance / Crash', 'Other']);
  const allowedSeverities = new Set(['Minor', 'Normal', 'Major', 'Gamebreaking']);
  if (title.length < 3 || Buffer.byteLength(title, 'utf8') > 200 || /[\x00-\x1F\x7F]/.test(title)) throw new Error('Bug title must be 3–200 bytes and contain no control characters.');
  if (!allowedCategories.has(category) || !allowedSeverities.has(severity)) throw new Error('Choose a valid category and severity.');
  if (!issue || Buffer.byteLength(issue, 'utf8') > 7000) throw new Error('Describe the issue in 1–7,000 bytes.');
  for (const [name, value] of [['Expected result', expected], ['Actual result', actual], ['Steps to reproduce', steps]]) {
    if (Buffer.byteLength(value, 'utf8') > 2500) throw new Error(`${name} is too long.`);
  }
  const body = [
    'Submitted from the Conquest of AzerothCore launcher.',
    '',
    '### Classification',
    `Category: ${category}`,
    `Severity: ${severity}`,
    '',
    '### Issue',
    issue,
  ];
  if (expected) body.push('', '### Expected outcome', expected);
  if (actual) body.push('', '### Actual outcome', actual);
  if (steps) body.push('', '### Steps to reproduce', steps);
  body.push('', '### Launcher', `Version: ${app.getVersion()}`);
  const combined = body.join('\n');
  if (Buffer.byteLength(combined, 'utf8') > 16000) throw new Error('The complete bug report is too long.');
  return { title, body: combined };
}

async function submitBugReport(report) {
  const payload = reportBody(report);
  const submitUrl = config.bugtracker?.submitUrl;
  if (typeof submitUrl === 'string' && submitUrl) {
    const endpoint = trustedHttps(submitUrl, 'Bug report endpoint');
    const response = await net.fetch(endpoint.href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'Conquest-of-AzerothCore-Launcher' },
      body: JSON.stringify(payload),
    });
    let data = null;
    try { data = await response.json(); } catch {}
    if (!response.ok) {
      if (response.status === 429) throw new Error('Bug reports are temporarily rate limited. Try again shortly.');
      throw new Error(data?.error || `Bug report service returned HTTP ${response.status}.`);
    }
    const number = Number(data?.issue_number);
    if (!Number.isInteger(number) || number <= 0) throw new Error('Bug report service returned an invalid issue number.');
    issueCache = { loadedAt: 0, issues: [] };
    return { mode: 'submitted', number };
  }

  // A distributed Electron app cannot safely contain the private Railway intake key.
  // Until a player-facing intake endpoint is configured, open a fully prefilled GitHub draft.
  const repository = bugRepository();
  const draft = new URL(`https://github.com/${repository}/issues/new`);
  draft.searchParams.set('title', payload.title);
  draft.searchParams.set('body', payload.body);
  await shell.openExternal(draft.href);
  return { mode: 'github' };
}

async function main() {
  settingsFile = path.join(app.getPath('userData'), 'settings.json');
  settings = await readSettings(settingsFile, message => dialog.showErrorBox(nativeText('Settings recovered'), message));
  const addonCatalogRoot = app.isPackaged ? path.join(process.resourcesPath, 'AddonCatalog') : path.resolve(__dirname, 'assets/AddonCatalog');
  addonService = new AddonService(addonCatalogRoot, { mandatoryFolders: config.mandatoryAddons || [], assetFolders: config.mandatoryAssetFolders || [] });
  clientUpdater = new ClientUpdater(config.manifestUrl, { fetchImpl: electronFetch, downloadLimit: () => settings.downloadLimitMBps * 1024 ** 2, graphicsCompatibility: file => file === 'dxgi.dll' ? settings.disableGraphicsEnhancements === true : settings.graphicsCompatibility === true, preserveFile: file => settings.customOwned.some(owned => owned.toLowerCase() === file.toLowerCase()), allowLocalHttp: localTesting, notify: status => sendStatus('launcher:client-progress', status), beforeApply: async () => { if (game || clientMutation) throw new Error('Wait for the game or addon operation to finish.'); await requireGameClosed(settings?.installPath); } });
  launcherUpdates = createLauncherUpdates(app, status => sendStatus('launcher:update-status', status), async () => {
    if (clientUpdater?.busy || clientMutation) throw new Error('Wait for the current client operation to finish before restarting.');
  });
  portal = new Portal(config.apiBaseUrl, {
    fetchImpl: electronFetch,
    allowLocalHttp: localTesting,
    cookieName: 'coa_launcher',
    sessionFile: path.join(app.getPath('userData'), 'launcher-account-session.bin'),
    encrypt: value => { if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw new Error('Windows account encryption is unavailable.'); return safeStorage.encryptString(value); },
    decrypt: value => safeStorage.decryptString(value)
  });
  gameCredentials = new GameCredentials(path.join(app.getPath('userData'), 'game-login.bin'),
    value => { if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw new Error('Secure credential storage is unavailable.'); return safeStorage.encryptString(value); },
    value => safeStorage.decryptString(value));
  if (!settings.autoLoginGame) await gameCredentials.write(null);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  
  const youtubeFilter = {
  urls: [
    'https://www.youtube-nocookie.com/*',
    'https://www.youtube.com/*'
  ]
};

session.defaultSession.webRequest.onBeforeSendHeaders(
  youtubeFilter,
  (details, callback) => {
    details.requestHeaders.Referer =
      'https://com.conquestofazerothcore.launcher/';

    callback({
      cancel: false,
      requestHeaders: details.requestHeaders
    });
  }
);

  protocol.handle('conquest', request => {
    const url = new URL(request.url);
    if (url.hostname !== 'launcher' || request.method !== 'GET') return new Response('Not found', { status: 404 });
    let relative;
    try { relative = decodeURIComponent(url.pathname).replace(/^\/+/, ''); }
    catch { return new Response('Bad path', { status: 400 }); }
    const file = path.resolve(publicRoot, relative || 'index.html');
    if (!file.startsWith(publicRoot + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).href);
  });

  window = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1060, minHeight: 720,
    frame: false, backgroundColor: '#160e0d', show: false,
    title: config.name,
    icon: path.join(publicRoot, 'assets/app-icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.once('ready-to-show', () => window?.show());
  window.on('close', event => {
    if (clientUpdater?.busy || clientMutation) {
      event.preventDefault();
      dialog.showMessageBox(window, { type: 'info', title: nativeText('Client operation in progress'), message: nativeText('Pause the client download before closing. If files are being applied, please wait for it to finish.') });
    }
  });
  window.on('closed', () => {
    for (const view of embeddedViews.values()) if (!view.webContents.isDestroyed()) view.webContents.close();
    embeddedViews.clear();
    window = null;
  });

  handle('launcher:bootstrap', async () => ({ config, settings, client: await clientInfo(), version: app.getVersion(), clientProgress: clientUpdater.status, launcherUpdate: launcherUpdates.status }));
  handle('launcher:taskbar-badge', count => updateTaskbarBadge(count));
  handle('launcher:legal-notices', async () => {
    const directory = app.isPackaged ? path.join(publicRoot, 'licenses') : path.resolve(__dirname, '../..');
    return Promise.all(['LICENSE', 'COPYING', 'ATTRIBUTION.md', 'THIRD_PARTY_NOTICES.md'].map(async name => ({ name, text: await fs.readFile(path.join(directory, name), 'utf8') })));
  });
  handle('launcher:account', async () => null); // no account service in this edition
  handle('launcher:discord', async () => null);
  // Account sign-in, registration and Discord linking are removed: this edition has no account service.

  handle('launcher:launcher-check', () => launcherUpdates.check());
  handle('launcher:launcher-install', () => launcherUpdates.install());
  handle('launcher:choose-install', chooseClientFolder);
  handle('launcher:client-check', async force => {
    if (config.localDownloadDemo) return { needsUpdate: false };
    await requireIdleClient();
    if (settings.installPath) await probeClientFolder(settings.installPath);
    return clientUpdater.check(settings.installPath, force === true);
  });
  handle('launcher:client-update', async force => {
    if (config.localDownloadDemo) throw new Error('Real client updates are disabled during the local download demo.');
    await requireIdleClient();
    if (settings.installPath) await probeClientFolder(settings.installPath);
    try { await clientUpdater.update(settings.installPath, force === true, true); }
    catch (error) { if (error.code === 'CLIENT_PAUSED') return { paused: true }; throw error; }
    clientUpdater.emit('ready', 'Your client is ready to play.');
    return clientInfo();
  });
  handle('launcher:client-pause', () => clientUpdater.cancel());
  handle('launcher:window', action => {
    if (action === 'minimize') window.minimize();
    else if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
    else if (action === 'close') window.close();
    else throw new Error('Unknown window action.');
  });
  handle('launcher:settings', async patch => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid settings.');
    if (Object.hasOwn(patch, 'downloadLimitMBps') && (typeof patch.downloadLimitMBps !== 'number' || !Number.isFinite(patch.downloadLimitMBps) || !(patch.downloadLimitMBps === 0 || patch.downloadLimitMBps >= 0.1 && patch.downloadLimitMBps <= 10000))) throw new Error('Enter 0 for unlimited, or a speed between 0.1 and 10000 MB/s.');
    const next = { ...settings };
    for (const key of ['language', 'startPage', 'launchBehavior', 'autoLaunchAfterUpdate', 'addonCleanupDismissed', 'rememberClient', 'hdPatches', 'wineCompatibility', 'autoLoginGame', 'downloadLimitMBps', 'graphicsCompatibility', 'disableGraphicsEnhancements', 'reducedMotion', 'sound', 'localMode']) {
      if (Object.hasOwn(patch, key)) next[key] = patch[key];
    }
    if (Object.hasOwn(patch, 'language') && ['en', 'fr', 'es-ES', 'ru', 'zh-CN'].includes(patch.language)) next.languageSelected = true;
    const saved = await persist(next);
    if (saved.autoLoginGame === false && Object.hasOwn(patch, 'autoLoginGame')) { portal?.clearGameLogin(); await gameCredentials.write(null); }
    return saved;
  });
  handle('launcher:choose-client', chooseClientFolder);
  handle('launcher:client-info', clientInfo);
  handle('launcher:launch', async () => {
    await requireIdleClient();
    if (game) throw new Error('Your game is already running.');
    const info = await clientInfo();
    if (!info.installed) throw new Error('Choose your installed client first.');
    // The game always starts with CoACustomRace.exe, installed by the CoA Custom Races module.
    if (info.customReady === false) throw new Error('CoACustomRace.exe is missing. Open Apply modules and install CoA Custom Races.');
    await mutateClient(() => configureClientGraphics(info.path, settings.graphicsCompatibility, settings.disableGraphicsEnhancements));
    if (!config.localDownloadDemo) {
      await probeClientFolder(info.path);
      const release = await clientUpdater.check(info.path, false, true);
      if (release.needsUpdate) return { running: false, needsUpdate: true };
    }
    await mutateClient(async () => {
      await clearClientCache(info.path);
      await configureRealm(info.path, settings.realmlist);
    });

    const credentialVersion = settings.autoLoginGame ? gameCredentials.version : 0;
    let savedGameLogin = null;
    if (settings.autoLoginGame) {
      const account = await portal.account();
      const credentials = portal.getGameLogin() || (account ? await gameCredentials.read(account.username) : null);
      savedGameLogin = credentials;
      if (!account || !credentials || account.username !== credentials.username) {
        portal.clearGameLogin();
        await gameCredentials.write(null);
        throw new Error('Sign into the launcher again to use automatic game login.');
      }
    }
    const launched = {};
    game = launched;
    try {
      launched.pid = await launchGame(path.join(info.path, info.executable || 'CoACustomRace.exe'), { hdPatches: settings.hdPatches, wineCompatibility: settings.wineCompatibility, getAutoLogin: () => {
        if (!settings.autoLoginGame) return null;
        if (credentialVersion !== gameCredentials.version) throw new Error('Sign into the launcher again to use automatic game login.');
        const credentials = portal.getGameLogin() || savedGameLogin;
        if (!credentials) throw new Error('Sign into the launcher again to use automatic game login.');
        return credentials;
      }, onLaunched: () => applyLauncherLaunchBehavior(settings.launchBehavior, { quit: () => app.quit(), minimize: () => { if (window && !window.isDestroyed()) window.minimize(); } }) });
    } catch (error) { game = null; throw error; }
    // Observe the independent process without owning its lifetime or I/O.
    const monitor = setInterval(() => {
      try { process.kill(launched.pid, 0); }
      catch (error) {
        if (error.code !== 'ESRCH') return;
        clearInterval(monitor);
        if (game === launched) game = null;
        sendStatus('launcher:game-exit');
      }
    }, 2000);
    monitor.unref();
    return { running: true };
  });
  handle('launcher:open-folder', async () => {
    const info = await clientInfo();
    if (!info.installed) throw new Error('Choose your installed client first.');
    const result = await shell.openPath(info.path);
    if (result) throw new Error(result);
  });
  handle('launcher:external', async key => {
    if (typeof key !== 'string' || !Object.hasOwn(config.links, key)) throw new Error('Unknown service.');
    if (localTesting && (key === 'account' || key === 'register')) { await shell.openExternal(config.links[key]); return; }
    await shell.openExternal(externalUrl(config.links[key]));
  });
  handle('launcher:database-view', async request => {
    if (!request || typeof request !== 'object') throw new Error('Invalid database view request.');
    if (request.visible === false) {
      for (const view of embeddedViews.values()) if (!view.webContents.isDestroyed()) view.setVisible(false);
      return { visible: false };
    }
    const view = ensureDatabaseView(request.page || 'database');
    for (const other of embeddedViews.values()) if (other !== view && !other.webContents.isDestroyed()) other.setVisible(false);
    view.setBounds(databaseBounds(request.bounds));
    view.setVisible(true);
    return { visible: true };
  });
  handle('launcher:database-reload', async page => {
    const view = ensureDatabaseView(page || 'database');
    view.webContents.reload();
  });
  handle('launcher:issues', async force => readIssues(force === true));
  handle('launcher:open-issue', async number => {
    if (!Number.isInteger(number) || number <= 0) throw new Error('Invalid issue number.');
    await shell.openExternal(`https://github.com/${bugRepository()}/issues/${number}`);
  });
  handle('launcher:submit-bug', submitBugReport);
  handle('launcher:addons', async verify => {
    if (clientMutation) throw new Error('Wait for the addon operation to finish.');
    if (!addonService) throw new Error('Addon catalog is not ready.');
    const info = await clientInfo();
    return addonService.list(info.addonsReady ? info.path : '', verify === true);
  });
  handle('launcher:addon-install', async packageId => mutateClient(async () => {
    if (game) throw new Error('Close the game before installing or repairing addons.');
    if (!addonService) throw new Error('Addon catalog is not ready.');
    const info = await clientInfo();
    if (!info.addonsReady) throw new Error('Choose your installed client first.');
    const plan = await addonService.planInstall(packageId, info.path);
    if (plan.length > 1) {
      const answer = await dialog.showMessageBox(window, { type: 'question', title: nativeText('Required addons'), message: nativeText('Install this addon and its required packages?'), detail: plan.map(pkg => pkg.name).join('\n'), buttons: [nativeText('Cancel'), nativeText('Install all')], defaultId: 1, cancelId: 0 });
      if (answer.response !== 1) return { result: { cancelled: true }, catalog: await addonService.list(info.path) };
    }
    const result = await addonService.install(packageId, info.path);
    return { result, catalog: await addonService.list(info.path) };
  }));
  handle('launcher:addon-uninstall', async (packageId, removeModified) => mutateClient(async () => {
    if (game) throw new Error('Close the game before uninstalling addons.');
    if (!addonService) throw new Error('Addon catalog is not ready.');
    const info = await clientInfo();
    if (!info.addonsReady) throw new Error('Choose your installed client first.');
    const result = await addonService.uninstall(packageId, info.path, removeModified === true);
    return { result, catalog: await addonService.list(info.path) };
  }));
  handle('launcher:clear-cache', async () => mutateClient(async () => {
    if (game) throw new Error('Close the game before clearing its cache.');
    return clearClientCache(settings?.installPath);
  }));
  handle('launcher:open-addons-folder', async () => {
    const info = await clientInfo();
    if (!info.addonsReady) throw new Error('Choose your installed client first.');
    writableClient(info.path);
    await safePath(info.path, 'Interface/AddOns/.probe', true);
    const folder = path.join(info.path, 'Interface', 'AddOns');
    await fs.mkdir(folder, { recursive: true });
    const result = await shell.openPath(folder);
    if (result) throw new Error(result);
  });

  // ---- CoA Custom Races: server, modules and realmlist ----
  const coa = new CoaCustom({ fetchImpl: electronFetch, notify: status => sendStatus('coa:progress', status) });
  const requireServer = async () => {
    if (!settings.serverPath || !(await fs.stat(path.join(settings.serverPath, 'Scripts/manage.py')).catch(() => null))) throw new Error('Create or locate your server first.');
    return settings.serverPath;
  };
  const realmAddress = () => settings.realmMode === 'local' ? '127.0.0.1' : settings.realmlist;
  handle('coa:network', () => networkAddresses());
  handle('coa:create-server', async () => {
    const result = await dialog.showOpenDialog(window, { title: nativeText('Choose an EMPTY folder for your server (about 15 GB)'), properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const created = await coa.createServer(result.filePaths[0]);
    await persist({ ...settings, serverPath: created.path, localMode: true, versions: { ...settings.versions, server: created.version } });
    return created;
  });
  handle('coa:locate-server', async () => {
    const result = await dialog.showOpenDialog(window, { title: nativeText('Choose your CoA server folder'), properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    if (!(await fs.stat(path.join(result.filePaths[0], 'Scripts/manage.py')).catch(() => null))) throw new Error('That folder is not a CoA server (Scripts/manage.py is missing).');
    await persist({ ...settings, serverPath: result.filePaths[0], localMode: true });
    return { path: settings.serverPath };
  });
  handle('coa:start-server', async () => coa.startServer(await requireServer(), realmAddress()));
  handle('coa:stop-server', async () => coa.stopServer(await requireServer()));
  handle('coa:apply-modules', async choice => {
    if (!choice || typeof choice !== 'object') throw new Error('Invalid module choice.');
    const modules = { squid: choice.squid === true, devMenu: choice.devMenu === true, races: choice.races === true };
    if (game) throw new Error('Close the game before applying modules.');
    const info = await clientInfo();
    if (!info.installed && (modules.squid || modules.devMenu || modules.races)) throw new Error('Download or locate the game client first.');
    if (info.installed) { writableClient(info.path); await requireGameClosed(info.path); }
    const result = await mutateClient(() => coa.applyModules({ serverPath: settings.serverPath, clientPath: info.installed ? info.path : '', ...modules }));
    await persist({ ...settings, modules, customOwned: result.owned || (modules.races ? settings.customOwned : []), versions: { ...settings.versions, ...result.versions } });
    return result;
  });
  // ---- updates, connected to each repository's latest GitHub release ----
  handle('coa:updates', async () => ({ installed: settings.versions, latest: await coa.latestVersions(), modules: settings.modules, server: settings.serverPath }));
  handle('coa:update-server', async () => {
    const result = await coa.updateServer(await requireServer(), settings.versions.server);
    await persist({ ...settings, versions: { ...settings.versions, server: result.version } });
    return result;
  });
  handle('coa:update-module', async key => {
    if (!['squid', 'devMenu', 'races'].includes(key)) throw new Error('Unknown module.');
    if (game) throw new Error('Close the game before updating.');
    const info = await clientInfo();
    if (!info.installed) throw new Error('Download or locate the game client first.');
    writableClient(info.path); await requireGameClosed(info.path);
    const result = await mutateClient(() => coa.applyModules({ clientPath: info.path, only: key }));
    await persist({ ...settings, customOwned: result.owned || settings.customOwned, versions: { ...settings.versions, ...result.versions } });
    return result;
  });
  // ---- backups and troubleshooting ----
  handle('coa:backups', async () => coa.listBackups(await requireServer()));
  handle('coa:backup', async () => coa.backup(await requireServer(), 'manual'));
  handle('coa:restore', async name => coa.restore(await requireServer(), String(name)));
  handle('coa:open-backups', async () => {
    const dir = coa.backupDir(await requireServer());
    await fs.mkdir(dir, { recursive: true });
    const result = await shell.openPath(dir);
    if (result) throw new Error(result);
  });
  handle('coa:troubleshoot', async () => {
    const info = await clientInfo();
    return coa.troubleshoot({ serverPath: settings.serverPath, clientPath: info.path || '', realmlist: settings.realmlist, realmMode: settings.realmMode, modules: settings.modules, versions: settings.versions });
  });
  // ---- races and bot races ----
  handle('coa:races', () => coa.races());
  handle('coa:bot-races', async () => coa.botRaces(await requireServer()));
  handle('coa:set-bot-races', async allowed => {
    if (!Array.isArray(allowed) || !allowed.every(Number.isInteger)) throw new Error('Invalid race list.');
    const known = [...new Set((await coa.races()).flatMap(race => race.ids))];
    return coa.setBotRaces(await requireServer(), allowed.filter(id => known.includes(id)), known);
  });
  handle('coa:set-realm', async (mode, address) => {
    if (!['local', 'lan', 'hamachi', 'custom'].includes(mode)) throw new Error('Unknown realm mode.');
    const value = mode === 'local' ? '127.0.0.1' : String(address || '').trim();
    if (!hostnameOk(value)) throw new Error('Enter a valid IP address or host name.');
    await persist({ ...settings, realmMode: mode, realmlist: value, localMode: true });
    // Hosting: tell the running server which address to hand out. Joining someone else: the client realmlist is enough.
    let server = 'not hosting';
    if (mode !== 'custom' && settings.serverPath) {
      try { await coa.setRealmAddress(settings.serverPath, value); server = 'updated'; }
      catch { server = 'applies at next server start'; }
    }
    return { realmlist: value, server };
  });
  handle('coa:open', async key => {
    const urls = { coffee: 'https://buymeacoffee.com/ilusixne', duff: 'https://github.com/Duff-SPP/ConquestOfAzerothCoreLauncher', races: 'https://github.com/ilusixn/CustomRacesCoa/releases/tag/coa-custom-2.0', devmenu: 'https://github.com/ilusixn/ilusixn-dev-menu/releases/latest', squid: 'https://github.com/Zyth45/squidbots-addon', hamachi: 'https://vpn.net/' };
    if (!Object.hasOwn(urls, key)) throw new Error('Unknown link.');
    await shell.openExternal(urls[key]);
  });

  await window.loadURL(appUrl);
  setTimeout(() => launcherUpdates.check(), 5000).unref();
  setInterval(() => launcherUpdates.check(), 4 * 60 * 60 * 1000).unref();
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus(); });
  app.whenReady().then(main).catch(error => { dialog.showErrorBox(nativeText('Launcher could not start'), error.message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
}
