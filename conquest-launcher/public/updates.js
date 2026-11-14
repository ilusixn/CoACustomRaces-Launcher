// Copyright (C) 2026 Duff (Duff-SPP). GPL-3.0-only; see LICENSE and ATTRIBUTION.md at the repository root.
'use strict';
state.clientProgress = state.clientProgress || { phase: 'idle', message: t('Checking client service…') };
state.launcherUpdate = state.launcherUpdate || { phase: 'idle', message: '' };
state.clientUpdatePlan = state.clientUpdatePlan || null;
state.launcherUpdateVersion = state.launcherUpdate?.version || '';
state.account = null;
const clientBusy = () => ['checking', 'downloading', 'verifying', 'staging', 'applying', 'finalizing', 'installing-required-addons', 'pausing'].includes(state.clientProgress.phase);
const sizeLabel = value => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(2)} GB` : `${(value / 1024 ** 2).toFixed(1)} MB`;
let downloadSample = null;
const soundedNotifications = new Set();
let notificationAudio = null;
let lastNotificationSound = -Infinity;
function playNotificationSound(kind, version = '') {
  const key = `${kind}:${version}`;
  if (soundedNotifications.has(key)) return;
  soundedNotifications.add(key);
  if (state.settings.sound === false || performance.now() - lastNotificationSound < 2000) return;
  lastNotificationSound = performance.now();
  try {
    if (!notificationAudio) { notificationAudio = new Audio('assets/sounds/notification.mp3'); notificationAudio.volume = 0.5; }
    notificationAudio.currentTime = 0;
    notificationAudio.play()?.catch(() => {});
  } catch (_) { /* Missing audio or blocked playback must never interrupt notifications. */ }
}
function downloadTiming(progress, now = performance.now()) {
  if (progress.phase !== 'downloading' || !Number.isFinite(progress.bytes) || !Number.isFinite(progress.totalBytes) || progress.totalBytes <= 0) { downloadSample = null; return null; }
  if (!downloadSample || progress.totalBytes !== downloadSample.total || progress.bytes < downloadSample.bytes) {
    downloadSample = { bytes: progress.bytes, total: progress.totalBytes, time: now, rate: 0 };
    return { rate: 0, seconds: null };
  }
  const elapsed = now - downloadSample.time;
  if (elapsed >= 1000) {
    const measured = Math.max(0, progress.bytes - downloadSample.bytes) * 1000 / elapsed;
    downloadSample.rate = downloadSample.rate ? downloadSample.rate * 0.5 + measured * 0.5 : measured;
    downloadSample.bytes = progress.bytes; downloadSample.time = now;
  }
  const rate = downloadSample.rate;
  return { rate, seconds: rate > 0 ? Math.ceil(Math.max(0, progress.totalBytes - progress.bytes) / rate) : null };
}
function remainingTimeLabel(seconds) {
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60), remainder = seconds % 60;
  return [hours, minutes, remainder].map(value => String(value).padStart(2, '0')).join(':');
}

function notificationCenterHtml() {
  const items = [];
  const clientAvailable = state.client?.installed && state.clientProgress.phase === 'available';
  const launcherDownloading = state.launcherUpdate.phase === 'downloading';
  const launcherReady = state.launcherUpdate.phase === 'downloaded';

  if (clientAvailable) {
    const plan = state.clientUpdatePlan;
    const version = state.clientProgress.version || plan?.version || '';
    let detail = t('An updated client release is ready to download.');
    if (plan?.needsUpdate && Number.isInteger(plan.files) && Number.isFinite(plan.bytes)) {
      detail = lt`${plan.files} files · ${sizeLabel(plan.bytes)}`;
    }
    items.push(lh`<section class="notification-item notification-item-actionable"><div class="notification-item-head"><span class="notification-type">${t('Client update')}</span><span class="notification-state">${t('AVAILABLE')}</span></div><strong>${version ? escape(lt`Release ${version}`) : t('Client update available')}</strong><p>${escape(detail)}</p><div class="notification-actions"><button class="gold-button" data-action="check-updates">${icon('download')}${t('Update now')}</button></div></section>`);
  }

  if (launcherReady) {
    const version = state.launcherUpdate.version || state.launcherUpdateVersion || '';
    items.push(lh`<section class="notification-item notification-item-actionable"><div class="notification-item-head"><span class="notification-type">${t('Launcher update')}</span><span class="notification-state">${t('UPDATE READY')}</span></div><strong>${version ? escape(lt`Launcher ${version}`) : t('Launcher update ready')}</strong><p>${escape(tm(state.launcherUpdate.message) || t('Restart the launcher to install the downloaded update.'))}</p><div class="notification-actions"><button class="gold-button" data-action="launcher-install">${icon('refresh')}${t('Restart & update')}</button></div></section>`);
  } else if (launcherDownloading) {
    const percent = Number.isFinite(state.launcherUpdate.percent) ? Math.max(0, Math.min(100, Math.floor(state.launcherUpdate.percent))) : null;
    const version = state.launcherUpdate.version || state.launcherUpdateVersion || '';
    items.push(lh`<section class="notification-item"><div class="notification-item-head"><span class="notification-type">${t('Launcher update')}</span><span class="notification-state">${t('DOWNLOADING')}</span></div><strong>${version ? escape(lt`Launcher ${version}`) : t('Launcher update downloading')}</strong><p>${escape(tm(state.launcherUpdate.message) || t('Downloading launcher update…'))}</p>${percent === null ? '' : lh`<progress class="notification-progress" max="100" value="${percent}" aria-label="Launcher update progress"></progress><small>${percent}%</small>`}</section>`);
  }

  return lh`<div class="popover-heading">${t('Notifications')}</div><div class="notification-subtitle">${t('Launcher and client updates')}</div><hr>${items.length ? lh`<div class="notification-list">${items.join('')}</div>` : lh`<div class="notification-empty">${icon('check')}<strong>${t('No update notifications.')}</strong><span>${t('Launcher and client updates will appear here when action is needed.')}</span></div>`}`;
}

let lastTaskbarCount = null;
function updateNotificationCenter() {
  const dot = document.querySelector('.notification-dot');
  const actionable = (state.client?.installed && state.clientProgress.phase === 'available') || state.launcherUpdate.phase === 'downloaded';
  const count = Number(!!(state.client?.installed && state.clientProgress.phase === 'available')) + Number(state.launcherUpdate.phase === 'downloaded');
  if (window.launcher?.taskbarBadge && count !== lastTaskbarCount) {
    lastTaskbarCount = count;
    window.launcher.taskbarBadge(count).catch(() => { if (lastTaskbarCount === count) lastTaskbarCount = null; });
  }
  if (dot) dot.hidden = !actionable;

  const button = document.querySelector('[data-action="notifications"]');
  if (button) button.setAttribute('aria-label', actionable ? t('Notifications, update available') : t('Notifications'));

  if (popoverRoot.dataset.open === 'notifications' && popoverRoot.firstElementChild) {
    popoverRoot.firstElementChild.innerHTML = notificationCenterHtml();
    fillIcons(popoverRoot.firstElementChild);
  }
}
window.launcherNotifications = { html: notificationCenterHtml };

function updateControls() {
  const progress = state.clientProgress;
  if (state.config.localDownloadDemo && progress.phase === 'idle' && !progress.message.startsWith('Demo complete')) progress.message = '10-minute download demo · No files will be written.';
  const discordText = document.querySelector('.discord-name small');
  if (discordText && state.discord?.available && state.discord.guildId === state.config.discord?.guildId) {
    const online = state.discord.online, members = state.discord.members;
    discordText.textContent = Number.isInteger(online) && Number.isInteger(members) ? lt`~${online.toLocaleString(launcherI18n.language)} online · ${members.toLocaleString(launcherI18n.language)} members` : t('Join our community');
  }
  const discordCard = document.querySelector('.discord-card');
  if (discordCard) discordCard.title = t('Join Conquest on Discord');
  const play = document.querySelector('.play-button');
  if (play) {
    play.disabled = clientBusy() || state.playPending === true || state.clientUpdatePending === true;
    play.querySelector('.play-title').textContent = state.client.running ? t('Playing') : clientBusy() ? (progress.phase === 'checking' ? t('Checking') : progress.phase === 'applying' ? t('Applying') : progress.phase === 'staging' ? t('Preparing') : t('Updating')) : progress.phase === 'available' || progress.phase === 'paused' ? (state.client.installed ? t('Update') : t('Download')) : state.client.installed ? t('Play') : t('Download');
    play.querySelector('.play-subtitle').textContent = state.client.running ? t('Your adventure is underway') : clientBusy() ? t('Preparing your adventure') : state.client.installed ? t('Enter Azeroth') : t('Begin your adventure');
  }
  let panel = document.getElementById('client-update-progress');
  const controls = document.querySelector('.client-controls');
  if (!panel && controls) {
    panel = document.createElement('div'); panel.id = 'client-update-progress'; panel.className = 'client-update-progress';
    panel.innerHTML = launcherI18n.html('<div class="download-heading"><span class="download-heading-label">Client status</span><span class="download-percent"></span></div><p class="update-message" role="status"></p><div class="download-meter"><progress aria-label="Client update progress" max="100"></progress></div><div class="update-detail"></div><div class="download-timing"></div><button class="ghost-button" data-action="pause-client">Pause download</button>');
    controls.append(panel);
  }
  if (panel) {
    panel.dataset.phase = progress.phase;
    const timing = downloadTiming(progress);
    const timingLabel = panel.querySelector('.download-timing');
    timingLabel.hidden = !timing;
    timingLabel.textContent = !timing ? '' : timing.seconds === null ? t('Estimating download speed…') : `${(timing.rate / 1024 ** 2).toFixed(2)} MB/s · ${t('Time remaining')}: ≈ ${remainingTimeLabel(timing.seconds)}`;
    const compactReady = progress.phase === 'ready' && !state.client.error && !state.client.detectionError && !progress.warnings?.length;
    panel.dataset.compactReady = String(compactReady);
    panel.querySelector('.update-message').hidden = compactReady;
    panel.querySelector('.download-meter').hidden = !clientBusy();
    panel.querySelector('.download-heading-label').textContent = ({ verifying: t('Verifying files'), finalizing: t('Finalizing update'), 'installing-required-addons': t('Installing required CoA addons'), pausing: t('Pausing update'), checking: t('Checking files'), downloading: t('Downloading client'), staging: t('Preparing downloaded files'), applying: t('Installing update'), paused: t('Download paused'), ready: t('Ready to play') })[progress.phase] || t('Client status');
    panel.querySelector('.update-message').textContent = tm(state.client.error || state.client.detectionError || progress.message) || '';
    const bar = panel.querySelector('progress'); bar.hidden = !clientBusy();
    if (progress.totalBytes) bar.value = Math.min(99, 100 * progress.bytes / progress.totalBytes);
    else if (progress.total) bar.value = Math.min(99, 100 * progress.completed / progress.total);
    else bar.removeAttribute('value');
    panel.querySelector('.download-percent').textContent = clientBusy() && bar.hasAttribute('value') ? `${Math.floor(bar.value)}%` : '';
    panel.querySelector('.update-detail').textContent = progress.phase === 'ready' ? (progress.version ? lt`Client ${progress.version}` : '') : progress.totalBytes ? `${sizeLabel(progress.bytes)} / ${sizeLabel(progress.totalBytes)}` : progress.version ? lt`Client ${progress.version}` : '';
    panel.querySelector('button').hidden = !['downloading', 'checking', 'verifying', 'staging'].includes(progress.phase);
  }
  document.getElementById('footer-client').textContent = state.client.running ? t('Game running') : clientBusy() ? t('Updating client') : progress.phase === 'ready' ? t('Client ready') : state.client.installed ? t('Client selected') : t('No client installed');
  const updateText = document.getElementById('launcher-update-message');
  if (updateText) updateText.textContent = tm(state.launcherUpdate.message);
  const restart = document.getElementById('launcher-restart');
  if (restart) restart.hidden = state.launcherUpdate.phase !== 'downloaded';
  const caption = document.querySelector('.preview-label');
  if (caption) caption.textContent = window.launcher ? (state.launcherUpdate.phase === 'downloaded' ? t('UPDATE READY') : '') : '';
  document.querySelector('.account-button')?.setAttribute('title', state.account ? lt`Signed in as ${state.account.username}` : t('Sign in to your game account'));
  updateNotificationCenter();
}
const renderWithOriginalDesign = render;
render = function () { renderWithOriginalDesign(); updateControls(); };

showInstall = function () {
  const selected = !!state.client.path;
  const existing = selected && state.client.installed;
  const action = !selected ? 'choose-install-folder' : existing ? 'use-selected-client' : 'install-selected-client';
  const label = !selected ? t('Choose game folder') : existing ? t('Use this client') : t('Download client here');
  openModal(lh`${modalHeader(t('Install Conquest of AzerothCore'), t('Your adventure starts here'))}<div class="modal-body"><div class="install-art"></div><p>${t('Select an empty folder to download the client, or a folder containing your existing client.')}</p><p>Interrupted downloads can resume. Your settings, addons and screenshots are preserved.</p>${selected ? lh`<p>${existing ? t('Existing client found. Use this client to continue.') : t('Game folder selected. Download the client here to continue.')}</p>` : ''}<div class="path-field">${icon('folder')}<span>${escape(state.client.path || t('Choose your game folder'))}</span></div></div><div class="modal-footer">${selected ? lh`<button class="secondary-button" data-action="choose-install-folder">${t('Change folder')}</button>` : ''}<button class="gold-button" data-action="${action}">${icon(existing ? 'check' : selected ? 'download' : 'folder')}${label}</button></div>`, 'install-dialog');
};
showAccount = function () {
  if (state.account) {
    openModal(lh`${modalHeader(lt`Welcome, ${state.account.username}`, t('Your game account'))}<div class="modal-body"><p>You are signed in to Conquest of AzerothCore.</p><div class="account-actions"><button class="gold-button" data-action="account-dashboard">Manage account</button><button class="secondary-button" data-action="logout">Sign out</button></div></div>`);
    return;
  }
  showAccountLogin();
};
document.addEventListener('submit', async event => {
  if (event.target.id !== 'launcher-login') return;
  event.preventDefault();
  await submitAccountLogin(event.target.querySelector('[type="submit"]'));
});
// Visual-only local demo. Never calls the updater or writes into the selected folder.
let downloadDemoTimer = null, downloadDemoElapsed = 0, downloadDemoStarted = 0;
function startDownloadDemo() {
  if (downloadDemoTimer) return;
  if (downloadDemoElapsed >= 600000) downloadDemoElapsed = 0;
  closeModal(); state.page = 'home'; render();
  downloadDemoStarted = performance.now() - downloadDemoElapsed;
  const files = ['Data/patch-A.MPQ', 'Data/patch-B.MPQ', 'Data/patch-C.MPQ', 'Data/patch-D.MPQ', 'Data/enUS/locale-enUS.MPQ', 'Ascension.exe'];
  const tick = () => {
    downloadDemoElapsed = Math.min(600000, performance.now() - downloadDemoStarted);
    const fraction = downloadDemoElapsed / 600000;
    state.clientProgress = { phase: 'downloading', message: lt`DEMO · Downloading ${files[Math.min(files.length - 1, Math.floor(fraction * files.length))]}`, bytes: Math.floor(24 * 1024 ** 3 * fraction), totalBytes: 24 * 1024 ** 3 };
    if (fraction >= 1) {
      clearInterval(downloadDemoTimer); downloadDemoTimer = null;
      state.clientProgress = { phase: 'idle', message: 'Demo complete · No files downloaded or changed.' };
    }
    updateControls();
  };
  downloadDemoTimer = setInterval(tick, 250); tick();
}
async function performClientUpdate(force = false) {
  if (state.clientUpdatePending) return false;
  if (state.config.localDownloadDemo) { startDownloadDemo(); return false; }
  if (state.clientProgress.phase === 'paused') force = state.resumeRepair === true;
  state.resumeRepair = force;
  state.clientUpdatePending = true;
  closeModal(); state.page = 'home'; render();
  try {
    const result = await api.updateClient(force);
    if (result.paused) return false;
    state.client = result; state.clientUpdatePlan = null; render(); toast(t('Client ready. Enjoy Azeroth!'));
    return true;
  } finally {
    try { state.client = await api.clientInfo(); }
    finally { state.clientUpdatePending = false; updateControls(); }
  }
}
pendingUpdate = async function (force = false) {
  state.forceRepair = force;
  if (!state.client.path) { showInstall(); return; }
  closeModal();
  const plan = await api.checkClient(force);
  state.clientUpdatePlan = plan;
  if (!plan.needsUpdate) { toast(plan.warnings?.length ? plan.warnings.join('\n') : t('Your client is up to date.')); return; }
  openModal(lh`${modalHeader(force ? t('Repair your client') : t('Client update available'), lt`Release ${plan.version}`)}<div class="modal-body"><p>${plan.files} files to download · ${sizeLabel(plan.bytes)}${plan.removed ? lt` · ${plan.removed} obsolete files to remove` : ''}</p><p>Game folder: ${escape(state.client.path)}</p><p>Your game must be closed while updating.</p></div><div class="modal-footer"><button class="secondary-button" data-action="dismiss-modal">Later</button><button class="gold-button" data-action="apply-client-update">Download & apply</button></div>`);
};
const settingsWithOriginalDesign = showSettings;
showSettings = function (tab = state.settingsTab) {
  settingsWithOriginalDesign(tab);
  const pane = document.querySelector('.settings-pane');
  if (tab === 'about') {
    pane.innerHTML = lh`<h3>Conquest of AzerothCore</h3><p>Launcher version ${escape(state.version)}</p><div class="setting-row"><span class="setting-title">Realm</span><span class="setting-description">${escape(state.config.realmlist || t('Not configured'))}</span></div><p id="launcher-update-message" role="status"></p><div class="button-row"><button class="secondary-button" data-action="launcher-check">Check launcher updates</button><button id="launcher-restart" class="gold-button" data-action="launcher-install" hidden>Restart & update</button></div><p class="credits">Launcher updates download automatically. Restart when you are ready to install them.</p>`;
    pane.insertAdjacentHTML('beforeend', launcherCreditsHtml());
  } else if (tab === 'launcher') {
    pane.insertAdjacentHTML('beforeend', toggleRow('sound', t('Notification sounds'), t('Play a sound when a client update is available or a launcher update is ready to install.')));
    pane.insertAdjacentHTML('beforeend', lh`<label class="setting-row"><span class="setting-title">${t('When the game starts')}</span><select data-setting="launchBehavior" aria-label="${t('When the game starts')}"><option value="close" ${state.settings.launchBehavior === 'close' ? 'selected' : ''}>${t('Close launcher')}</option><option value="minimize" ${state.settings.launchBehavior === 'minimize' ? 'selected' : ''}>${t('Minimize launcher')}</option><option value="keep-open" ${state.settings.launchBehavior === 'keep-open' ? 'selected' : ''}>${t('Keep launcher open')}</option></select></label>`);
    pane.insertAdjacentHTML('beforeend', launcherI18n.html('<div class="button-row"><button class="secondary-button" data-action="launcher-check">Check launcher updates</button><button id="launcher-restart" class="gold-button" data-action="launcher-install" hidden>Restart & update</button></div><p id="launcher-update-message" role="status"></p>'));
  } else if (tab === 'game') {
    pane.insertAdjacentHTML('beforeend', toggleRow('autoLaunchAfterUpdate', t('Launch game after updating'), t('Automatically starts the game after updating with the main button. Turn off to update without launching. Your realmlist changes only when you launch the game.')));
    pane.insertAdjacentHTML('beforeend', lh`<div class="setting-row"><span><span class="setting-title">${t('Clear game cache')}</span><span class="setting-description">${t('Removes the game Cache folder. The game recreates it when needed; settings and addons are kept.')}</span></span><button class="secondary-button" data-action="clear-cache" ${!state.client.installed || state.client.running || clientBusy() ? 'disabled' : ''}>${t('Clear cache')}</button></div>`);
    pane.insertAdjacentHTML('beforeend', toggleRow('graphicsCompatibility', t('Use compatibility graphics (disable DXVK)'), t('Try this if the game shows “Failed to find a suitable display device.” Uses the default DirectX renderer. Applies on your next launch.')));
    pane.insertAdjacentHTML('beforeend', toggleRow('disableGraphicsEnhancements', t('Disable additional graphics enhancements'), t('Try this for graphics-related Error #132 crashes. Applies on your next launch, independently of compatibility graphics.')));
    pane.insertAdjacentHTML('beforeend', toggleRow('wineCompatibility', t('Linux / Wine compatibility'), t('Try this if the game disconnects while entering the world under Wine. Disables divxtac for the game in this Wine prefix. Applies on your next launch.')));
    pane.querySelector('.credits').textContent = t('Updates are checked at startup and downloaded when you click Update. Scan & repair verifies every managed file.');
  }
  updateControls();
};
actions.account = () => showAccount();
actions['account-dashboard'] = () => loadAccountDashboard();
actions.settings = () => showSettings('launcher');
actions['game-settings'] = () => showSettings('game');
actions['check-updates'] = () => pendingUpdate(false);
actions.repair = () => {
  openModal(lh`${modalHeader(t('Repair your client'))}<div class="modal-body"><p>${t('Repair checks every launcher-managed file against the published client release.')}</p><ul><li>${t('Missing or changed managed files are downloaded again, including customized managed DLLs.')}</li><li>${t('Published patch filenames are restored. A patch you renamed to enable or disable it may be downloaded again under its published name.')}</li><li>${t('Unchanged obsolete managed files may be removed. Your settings, addons, screenshots, and extra unmanaged files are preserved.')}</li></ul><p>${t('Normal updates preserve customized DLLs and patch toggles. Use Repair when you want to restore managed client files.')}</p><p>${t('Your game must be closed while updating.')}</p></div><div class="modal-footer"><button class="secondary-button" data-action="dismiss-modal">Cancel</button><button class="gold-button" data-action="confirm-client-repair">${icon('shield')}${t('Continue to scan')}</button></div>`);
};
actions['confirm-client-repair'] = () => pendingUpdate(true);
actions['clear-cache'] = () => {
  openModal(lh`${modalHeader(t('Clear game cache'))}<div class="modal-body"><p>${t('Removes the game Cache folder. The game recreates it when needed; settings and addons are kept.')}</p><p>${t('Close the game before clearing its cache.')}</p><div class="path-field">${icon('folder')}<span>${escape(state.client.path)}</span></div></div><div class="modal-footer"><button class="secondary-button" data-action="dismiss-modal">Cancel</button><button class="gold-button" data-action="confirm-clear-cache">${t('Clear cache')}</button></div>`);
};
actions['confirm-clear-cache'] = async button => {
  button.disabled = true;
  try {
    const result = await api.clearCache();
    closeModal(); showSettings('game');
    toast(t(result.cleared ? 'Game cache cleared.' : 'The game cache is already empty.'));
  } finally { button.disabled = false; }
};
actions['pause-client'] = () => {
  if (!state.config.localDownloadDemo) return api.pauseClient();
  clearInterval(downloadDemoTimer); downloadDemoTimer = null;
  state.clientProgress = { phase: 'paused', message: t('DEMO paused · Click Download to resume.') }; updateControls();
};
actions['apply-client-update'] = () => performClientUpdate(state.forceRepair === true);
actions['install-selected-client'] = () => performClientUpdate();
actions['choose-install-folder'] = async () => {
  const client = await api.chooseInstall(); if (!client) return;
  state.client = client; state.settings.installPath = client.path;
  state.addons = []; state.addonFolderCount = 0; state.addonClientPath = null; state.addonWarning = '';
  render(); showInstall();
};
actions['install-client'] = actions['choose-install-folder'];
actions['use-selected-client'] = () => {
  closeModal(); render();
  toast(t('Client selected. Files will be checked before playing.'));
};
actions.logout = async () => { try { await api.logout(); } finally { state.account = null; state.accountOverview = null; state.accountCharacters = []; state.discordLink = null; showAccount(); updateControls(); } };
actions['launcher-check'] = async () => { state.launcherUpdate = await api.checkLauncher(); updateControls(); };
actions['launcher-install'] = () => api.installLauncherUpdate();
actions.play = async () => {
  if (state.playPending || state.clientUpdatePending || clientBusy()) return;
  if (state.client.running) { toast(t('Your game is already running.')); return; }
  if (!state.client.installed && state.clientProgress.phase !== 'paused') { showInstall(); return; }
  state.playPending = true;
  updateControls();
  try {
  if (['available', 'paused'].includes(state.clientProgress.phase)) {
    if (await performClientUpdate() === false) return;
    if (state.settings?.autoLaunchAfterUpdate === false) return;
  }
  // CoA Custom Races edition: the game starts with CoACustomRace.exe, which the Custom Races module installs.
  if (state.client.installed && state.client.customReady === false) {
    state.settings.modules = { ...(state.settings.modules || {}), races: true };
    showModules(); toast(t('Install CoA Custom Races first: it adds CoACustomRace.exe, the game this launcher starts.'));
    return;
  }
  let result = await api.launch();
  if (result.needsUpdate) {
    if (await performClientUpdate() === false) return;
    if (state.settings?.autoLaunchAfterUpdate === false) return;
    result = await api.launch();
  }
  if (!result.running) throw new Error(t('The client release changed while updating. Please try again.'));
  state.client.running = true; render();
  } finally {
    state.playPending = false;
    updateControls();
  }
};
if (window.launcher) {
  api.onClientProgress(progress => {
    state.clientProgress = progress;
    if (progress.phase === 'ready') state.clientUpdatePlan = null;
    updateControls();
    if (progress.phase === 'available' && state.client.installed) playNotificationSound('client-update', progress.version);
    if (progress.phase === 'ready' && progress.warnings?.length) toast(progress.warnings.join('\n'));
  });
  api.onLauncherUpdate(status => { state.launcherUpdate = status; if (status.version) state.launcherUpdateVersion = status.version; updateControls(); if (status.phase === 'downloaded') { playNotificationSound('launcher-update', status.version); toast(tm(status.message) + ' ' + t('Open Settings to restart.')); } });
  window.addEventListener('DOMContentLoaded', async () => {
    await api.bootstrap();
    let refreshingClient = false;
    const refreshClient = async () => {
      if (refreshingClient) return;
      refreshingClient = true;
      try { state.client = await api.clientInfo(); updateControls(); } catch {} finally { refreshingClient = false; }
    };
    window.addEventListener('focus', refreshClient);
    setInterval(refreshClient, 10000);
    state.accountServiceAvailable = null; // no account service: local server, LAN or Hamachi only
    try {
      if (!state.client.running) state.clientUpdatePlan = await api.checkClient(false);
      // Checking is automatic; downloading/applying always requires a player click.
    } catch (error) { state.clientProgress = { phase: 'error', message: tm(error.message) }; }
    updateControls();
  });
} else {
  for (const key of ['chooseInstall', 'checkClient', 'updateClient', 'login', 'logout', 'discordLinkStatus', 'discordLink', 'discordUnlink', 'checkLauncher', 'installLauncherUpdate']) api[key] = async () => { throw new Error(t('Open the installed desktop launcher to use this feature.')); };
  updateControls();
}
