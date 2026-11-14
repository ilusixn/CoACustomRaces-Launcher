// Copyright (C) 2026 Duff (Duff-SPP). GPL-3.0-only; see LICENSE and ATTRIBUTION.md at the repository root.
const { contextBridge, ipcRenderer } = require('electron');

async function invoke(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

contextBridge.exposeInMainWorld('launcher', Object.freeze({
  bootstrap: () => invoke('launcher:bootstrap'),
  window: action => invoke('launcher:window', action),
  saveSettings: patch => invoke('launcher:settings', patch),
  chooseClient: () => invoke('launcher:choose-client'),
  chooseInstall: () => invoke('launcher:choose-install'),
  checkClient: force => invoke('launcher:client-check', force === true),
  updateClient: force => invoke('launcher:client-update', force === true),
  pauseClient: () => invoke('launcher:client-pause'),
  clearCache: () => invoke('launcher:clear-cache'),
  account: () => invoke('launcher:account'),
  legalNotices: () => invoke('launcher:legal-notices'),
  discord: () => invoke('launcher:discord'),
  login: (login, password, code, remember) => invoke('launcher:login', login, password, code, remember),
  register: (username, email, password, confirmPassword, acceptTestWarning) => invoke('launcher:register', username, email, password, confirmPassword, acceptTestWarning === true),
  accountOverview: () => invoke('launcher:account-overview'),
  accountCharacters: () => invoke('launcher:account-characters'),
  discordLinkStatus: () => invoke('launcher:discord-link-status'),
  discordLink: () => invoke('launcher:discord-link-start'),
  discordUnlink: () => invoke('launcher:discord-link-unlink'),
  logout: () => invoke('launcher:logout'),

  checkLauncher: () => invoke('launcher:launcher-check'),
  taskbarBadge: count => invoke('launcher:taskbar-badge', count),
  installLauncherUpdate: () => invoke('launcher:launcher-install'),
  onClientProgress: callback => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('launcher:client-progress', listener);
    return () => ipcRenderer.removeListener('launcher:client-progress', listener);
  },
  onLauncherUpdate: callback => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('launcher:update-status', listener);
    return () => ipcRenderer.removeListener('launcher:update-status', listener);
  },
  clientInfo: () => invoke('launcher:client-info'),
  launch: () => invoke('launcher:launch'),
  openFolder: () => invoke('launcher:open-folder'),
  external: key => invoke('launcher:external', key),
  databaseView: request => invoke('launcher:database-view', request),
  reloadDatabase: page => invoke('launcher:database-reload', page),
  issues: force => invoke('launcher:issues', force === true),
  openIssue: number => invoke('launcher:open-issue', number),
  submitBug: report => invoke('launcher:submit-bug', report),
  addons: verify => invoke('launcher:addons', verify === true),
  installAddon: packageId => invoke('launcher:addon-install', packageId),
  uninstallAddon: (packageId, removeModified = false) => invoke('launcher:addon-uninstall', packageId, removeModified),
  openAddonsFolder: () => invoke('launcher:open-addons-folder'),
  onDatabaseStatus: callback => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('launcher:database-status', listener);
    return () => ipcRenderer.removeListener('launcher:database-status', listener);
  },
  coaNetwork: () => invoke('coa:network'),
  coaCreateServer: () => invoke('coa:create-server'),
  coaLocateServer: () => invoke('coa:locate-server'),
  coaStartServer: () => invoke('coa:start-server'),
  coaStopServer: () => invoke('coa:stop-server'),
  coaApplyModules: choice => invoke('coa:apply-modules', choice),
  coaSetRealm: (mode, address) => invoke('coa:set-realm', mode, address),
  coaOpen: key => invoke('coa:open', key),
  coaUpdates: () => invoke('coa:updates'),
  coaUpdateServer: () => invoke('coa:update-server'),
  coaUpdateModule: key => invoke('coa:update-module', key),
  coaRaces: () => invoke('coa:races'),
  coaBotRaces: () => invoke('coa:bot-races'),
  coaSetBotRaces: allowed => invoke('coa:set-bot-races', allowed),
  onCoaProgress: callback => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('coa:progress', listener);
    return () => ipcRenderer.removeListener('coa:progress', listener);
  },
  onGameExit: callback => {
    const listener = () => callback();
    ipcRenderer.on('launcher:game-exit', listener);
    return () => ipcRenderer.removeListener('launcher:game-exit', listener);
  }
}));
