// Copyright (C) 2026 Duff (Duff-SPP). GPL-3.0-only; see LICENSE and ATTRIBUTION.md at the repository root.
const fs = require('node:fs/promises');
const path = require('node:path');

const defaults = Object.freeze({ language: 'en', languageSelected: false, startPage: 'home', launchBehavior: 'close', autoLaunchAfterUpdate: true, addonCleanupDismissed: false, rememberClient: true, hdPatches: true, wineCompatibility: false, autoLoginGame: false, downloadLimitMBps: 0, graphicsCompatibility: false, disableGraphicsEnhancements: false, reducedMotion: false, sound: true, installPath: '',
  // CoA Custom Races additions
  localMode: false, serverPath: '', realmMode: 'local', realmlist: '127.0.0.1', modules: { squid: false, devMenu: false, races: false }, customOwned: [] });
function sanitize(value) {
  const result = { ...defaults };
  if (!value || typeof value !== 'object') return result;
  if (['en', 'fr', 'es-ES', 'ru', 'zh-CN'].includes(value.language)) {
    result.language = value.language;
    // Keep valid preferences from older launchers without a selection marker.
    result.languageSelected = typeof value.languageSelected === 'boolean' ? value.languageSelected : true;
  }
  if (['close', 'minimize', 'keep-open'].includes(value.launchBehavior)) result.launchBehavior = value.launchBehavior;
  if (['home', 'news'].includes(value.startPage)) result.startPage = value.startPage;
  for (const key of ['addonCleanupDismissed', 'autoLaunchAfterUpdate', 'rememberClient', 'hdPatches', 'wineCompatibility', 'autoLoginGame', 'graphicsCompatibility', 'disableGraphicsEnhancements', 'reducedMotion', 'sound']) {
    if (typeof value[key] === 'boolean') result[key] = value[key];
  }
  if (typeof value.downloadLimitMBps === 'number' && Number.isFinite(value.downloadLimitMBps) && (value.downloadLimitMBps === 0 || value.downloadLimitMBps >= 0.1 && value.downloadLimitMBps <= 10000)) result.downloadLimitMBps = Math.round(value.downloadLimitMBps * 10) / 10;
  if (typeof value.installPath === 'string' && path.isAbsolute(value.installPath)) result.installPath = path.normalize(value.installPath);
  if (typeof value.localMode === 'boolean') result.localMode = value.localMode;
  if (typeof value.serverPath === 'string' && (!value.serverPath || path.isAbsolute(value.serverPath))) result.serverPath = value.serverPath && path.normalize(value.serverPath);
  if (['local', 'lan', 'hamachi', 'custom'].includes(value.realmMode)) result.realmMode = value.realmMode;
  if (typeof value.realmlist === 'string' && /^[a-zA-Z0-9.-]{1,253}$/.test(value.realmlist)) result.realmlist = value.realmlist;
  if (value.modules && typeof value.modules === 'object') result.modules = { squid: value.modules.squid === true, devMenu: value.modules.devMenu === true, races: value.modules.races === true };
  if (Array.isArray(value.customOwned)) result.customOwned = value.customOwned.filter(p => typeof p === 'string' && /^[\w./ -]+$/.test(p)).slice(0, 100);
  return result;
}
async function readSettings(file, warn = console.warn) {
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SyntaxError('Invalid settings object.');
    const settings = sanitize(value);
    if (!settings.rememberClient) settings.installPath = '';
    return settings;
  } catch (error) {
    if (error.code === 'ENOENT') return { ...defaults };
    if (!(error instanceof SyntaxError)) throw error;
    const backup = file + '.corrupt-' + Date.now();
    await fs.copyFile(file, backup, require('node:fs').constants.COPYFILE_EXCL);
    warn(`Settings could not be read. The original was preserved at ${backup}. Defaults will be used; please select your client again.`);
    return { ...defaults };
  }
}
async function saveSettings(file, value) {
  const settings = sanitize(value);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file + '.tmp', JSON.stringify({ ...settings, installPath: settings.rememberClient ? settings.installPath : '' }, null, 2), 'utf8');
  await fs.rename(file + '.tmp', file);
  return settings;
}
function externalUrl(value) {
  if (typeof value !== 'string' || !value) throw new Error('This service has not been connected yet.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Service links must use HTTPS.');
  return url.href;
}
module.exports = { defaults, sanitize, readSettings, saveSettings, externalUrl };
