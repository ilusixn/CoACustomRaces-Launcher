// Copyright (C) 2026 Duff (Duff-SPP). GPL-3.0-only; see LICENSE and ATTRIBUTION.md at the repository root.
/* Local renderer: no remote scripts, credentials, or reference-launcher services. */
'use strict';
const icons = {
  builder: '<path d="M5 5h5v5H5zM14 14h5v5h-5zM5 14h5v5H5zM7.5 10v4m2.5-6.5h7v6.5"/>',
  home: launcherI18n.html('<path d="m3 10 9-7 9 7v10H7V10"/><path d="M10 20v-7h5v7"/>'),
  news: launcherI18n.html('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 8h8M8 12h3M8 16h3M14 12h2M14 16h2"/>'),
  store: launcherI18n.html('<path d="M3 9 5 4h14l2 5M4 10v10h16V10M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M9 20v-6h6v6"/>'),
  heart: launcherI18n.html('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>'),
  bug: launcherI18n.html('<rect x="7" y="7" width="10" height="14" rx="5"/><path d="M9 7V5a3 3 0 0 1 6 0v2M12 10v11M3 9l4 2M21 9l-4 2M2 15h5m10 0h5M4 21l4-3m8 0 4 3"/>'),
  book: launcherI18n.html('<path d="M12 5v16M12 5C8 2 4 3 2 4v15c4-2 7-1 10 2 3-3 6-4 10-2V4c-2-1-6-2-10 1Z"/>'),
  database: launcherI18n.html('<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>'),
  addons: launcherI18n.html('<path d="M9 3h6v5c5-3 6 5 0 3v5h-5c3 5-5 6-3 0H3V9h5c-3-5 5-6 1-6Z"/>'),
  bell: launcherI18n.html('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>'),
  settings: launcherI18n.html('<path d="m9 3 1-1h4l1 3 3 1 3 1 1 4-2 2-1 3v3l-4 2-2-2h-3l-3 1-3-3 1-3-1-3-2-2 2-4 3 1Z"/><circle cx="12" cy="12" r="3"/>'),
  user: launcherI18n.html('<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>'),
  download: launcherI18n.html('<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>'),
  play: launcherI18n.html('<path d="m7 3 14 9-14 9Z"/>'),
  folder: launcherI18n.html('<path d="M3 7V4h6l3 3h9v14H3Z"/><path d="M3 10h18"/>'),
  info: launcherI18n.html('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>'),
  external: launcherI18n.html('<path d="M14 3h7v7m0-7L10 14M9 3H3v18h18v-6"/>'),
  discord: launcherI18n.html('<path d="M8 5 5 6c-2 4-3 8-3 11l5 2 1-2m8-12 3 1c2 4 3 8 3 11l-5 2-1-2M6 16c4 2 8 2 12 0M8 5l1 2a16 16 0 0 1 6 0l1-2"/><ellipse cx="8" cy="12" rx="1" ry="1.5"/><ellipse cx="16" cy="12" rx="1" ry="1.5"/>'),
  arrow: launcherI18n.html('<path d="M4 12h16m-6-6 6 6-6 6"/>'),
  check: launcherI18n.html('<path d="m4 12 5 5L20 6"/>'),
  search: launcherI18n.html('<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>'),
  refresh: launcherI18n.html('<path d="M3 10a9 9 0 0 1 15-6l3 3M21 3v4h-4M21 14A9 9 0 0 1 6 20l-3-3M3 21v-4h4"/>'),
  shield: launcherI18n.html('<path d="m12 2 9 4v6c0 6-9 10-9 10S3 18 3 12V6Z"/><path d="m8 12 3 3 5-6"/>'),
  globe: launcherI18n.html('<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>'),
  monitor: launcherI18n.html('<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M12 17v4m-5 0h10"/>'),
  logout: launcherI18n.html('<path d="M9 3H3v18h6M9 12h12m-5-5 5 5-5 5"/>'),
};
const icon = name => lh`<i data-icon="${name}"><svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.info}</svg></i>`;
function fillIcons(root = document) { for (const node of root.querySelectorAll('i[data-icon]:empty')) node.innerHTML = lh`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[node.dataset.icon] || icons.info}</svg>`; }
function escape(value = '') { return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }
const articles = [
{
  id: 'welcome',
  category: 'ANNOUNCEMENT',
  title: 'Welcome to CoA Custom Races',
  summary: 'Your gateway to the live realms begins here.',
  image: 'portal.webp',
  body: [
    'Use the launcher to install, update, and repair your client, manage addons, and access account features in one place.',
    'Play on the live realms, with PTR realms available for testing.',
    'Stay tuned for future project announcements, patch notes, and community updates.'
  ]
},
{
  id: 'world',
  category: 'EXPLORE',
  title: 'A world waiting to be rediscovered',
  summary: 'Familiar lands. New stories. Find your way back to Azeroth.',
  image: 'world-background.png',
  body: [
    'From the gates of ancient cities to the far reaches of Azeroth, your next journey is waiting.',
    'Explore familiar lands and find your next adventure in Azeroth.'
  ]
},
  { id: 'journey', category: 'DEVELOPMENT', title: 'Building the journey ahead', summary: 'Follow the development of CoA Custom Races.', image: 'landscape.webp', body: ['Follow development updates, changelogs, and community announcements here.', 'Check back for the latest project news.'] },
  { id: 'community', category: 'COMMUNITY', title: 'Your adventure. Our community.', summary: 'Find your guild, share your stories, and stay connected.', image: 'trailer.jpg', body: ['Azeroth is better together. Join the CoA Custom Races community on Discord.', 'Use the Discord button to meet other players and stay connected.'] }
];
function launcherCreditsHtml() {
  return lh`<section class="launcher-credits"><h4>${t('Credits & license')}</h4><p>Originally developed by Duff (Duff-SPP) as Conquest Launcher.</p><p>${t('GPLv3 with author-attribution terms. This software comes with no warranty. Third-party assets retain their own rights.')}</p><button class="ghost-button" data-action="view-license">${t('License & attribution')}</button><button class="ghost-button" data-external="source">${t('Source code')}</button></section>`;
}

async function showLegalNotices() {
  const notices = await api.legalNotices();
  openModal(lh`${modalHeader(t('License & attribution'))}<div class="modal-body">${notices.map(notice => lh`<details><summary>${escape(notice.name)}</summary><pre class="legal-text">${escape(notice.text)}</pre></details>`).join('')}</div><div class="modal-footer"><button class="gold-button" data-action="dismiss-modal">${t('Done')}</button></div>`);
}

const changelogEntries = [
  { version: '1.0.0', items: [
    'CoA Custom Races edition by ilusixn, based on Conquest Launcher by Duff (Duff-SPP).',
    'Added Create server: downloads the latest CoA server build and sets it up.',
    'Added Apply modules: SquidBots, ilusixn Dev Menu and CoA Custom Races V2.',
    'Added realmlist modes for local, LAN, LogMeIn Hamachi and joining a friend.',
    'Added Play on my own server without a coa-development.org account.',
    'Added Buy me a coffee.'
  ] },
  { version: '0.8.1', items: [
    'Added a welcome screen requiring account sign-in before entering the launcher.',
    'Added Remember me with encrypted account sessions and optional saved game auto-login credentials.',
    'Client downloads and repairs now require the exact launcher version configured on the backend; launcher updates remain available.'
  ] },
  {
    version: '0.8.0',
    items: [
      'Removed PowerShell from running-game detection, fixing empty-response JSON errors while checking the selected client folder.',
      'Improved custom-folder installer diagnostics and isolated ownership-manifest extraction in the installer temporary directory.',
      'Added optional automatic game login using credentials retained only for the current launcher session.',
      'Added launcher sign-in support for authenticator and recovery codes.',
      'The game cache is now cleared automatically before every launcher-started game session.',
      'Allowed dedicated client subfolders inside the launcher installation while protecting launcher runtime folders.'
    ]
  },
  {
    version: '0.7.8',
    items: [
      'Added Downloads settings with a saved client download speed limit, adjustable during downloads and repairs.',
      'Pausing a client download now keeps the download resumable without showing an aborted-operation error.'
    ]
  },
  {
    version: '0.7.7',
    items: [
      'Game detection now checks executable paths in the selected client folder. Games running from other folders no longer block Play, updates, or folder selection.',
      'Added an optional Linux / Wine compatibility setting for the reported Enter World loading-screen disconnect.'
    ]
  },
  {
    version: '0.7.6',
    items: [
      'Fixed the Addons page repeatedly reloading when no addons are found or a scan fails. Rescan remains available for manual retries.',
      'Fixed Do not remind me again not saving for the old addon cleanup reminder.',
      'Automatically handles read-only realmlist files before launching and explains how to resolve blocked file access.',
      'The old addon cleanup reminder now appears only when old launcher-managed addons remain installed.',
      'Play checks for client updates and updates before launching, respecting the Launch game after updating setting. Repeated clicks cannot start overlapping Play actions.'
    ]
  },
  {
    version: '0.7.5',
    items: [
      'Fixed outdated addon catalog entries reappearing after launcher updates. Browse addons now lists only addons included in the current release.',
      'Previously launcher-installed addons remain available under Installed addons for uninstalling.'
    ]
  },
  {
    version: '0.7.4',
    items: [
      'Added separate saved toggles for compatibility graphics and additional graphics enhancements.',
      'Added options to close, minimize, or keep the launcher open when the game starts.',
      'Added a saved option to update the client without automatically launching the game.',
      'Client updates now preserve your realmlist. The PTR realmlist is applied only when launching the game.',
      'Fixed client updates and graphics toggles failing on exFAT drives when hard links are unsupported.'
    ]
  },
  {
    version: '0.7.3',
    items: [
      'Reduced temporary disk space needed for client installation and updates by reusing verified downloads during staging on supported drives.'
    ]
  },
  {
    version: '0.7.2',
    items: [
      'Fixed leftover client download files taking up extra disk space after an interrupted cleanup. Update checks now remove downloads no longer needed while preserving resumable downloads.',
      'Removed outdated addon catalog downloads. Uninstall addons previously installed through the launcher catalog to avoid conflicts with addons supplied by patch B.',
      'Added an offline Class Builder with all 21 classes, talent trees, and specialization choices directly in the launcher.',
      'Plan builds with AE and TE tracking, talent prerequisites, rank selection, and purchase or refund controls.',
      'Save and load builds locally, or share them using build codes and JSON import or export.',
      'Improved game folder selection with clear confirmation for downloading a new client or using an existing client.',
      'Improved launcher update installation by waiting longer for shutdown and allowing Retry if the launcher is still closing.'
    ]
  },
  {
    version: '0.7.1',
    items: [
      'Fixed normal updates to always restore the required Extensions.dll from the published client release.',
      'Added a saved compatibility graphics option for players experiencing display device errors.',
      'Added Clear cache in Game client settings to remove cached game data while preserving settings and addons.',
      'Added an optional saved setting to clear the game cache before every launcher-started game session.'
    ]
  },
  {
    version: '0.7.0',
    items: [
      'Redesigned the Discord community popup with a banner, live member counts, and a clearer Join Discord button.',
      'Added a first-start language selector that remembers your choice and keeps language changes available through the globe button.',
      'Added download speed and estimated time remaining while downloading the client.',
      'Added a Repair explanation dialog covering managed DLL replacement, patch filenames, and preserved player files.',
      'Added the Armory inside the launcher with reload and loading status.',
      'Added a saved Enable HD patches checkbox below Play, applied on the next game launch.',
      'Improved networking for client downloads and account services using the launcher browser network stack.',
      'Fixed account session cookie handling, saved sign-in updates, and sign-out cleanup.',
      'Normal updates now preserve customized DLLs; Repair still restores managed files.',
      'Normal updates respect enabled or disabled MPQ patches without downloading a duplicate filename.',
      'Improved game window visibility and running-game detection.'
    ]
  },
  {
    version: '0.6.9',
    items: [
      'Added multilingual launcher support with saved language selection for English, French, Spanish, Russian, and Simplified Chinese.',
      'Added launcher theme changing.',
      'Added update notifications for client releases and launcher updates.'
    ]
  },
  {
    version: '0.6.8',
    items: [
      'Improved installer and uninstaller ownership, locking, registration, and build handling to better protect player files.',
      'Improved production bundle protection while preserving launcher update compatibility.'
    ]
  },
  {
    version: '0.6.7',
    items: [
      'Added optional minimum launcher compatibility checks and expanded downloader regression coverage.'
    ]
  },
  {
    version: '0.6.6',
    items: [
      'Improved addon backup and recovery, dependency handling, stale inventory refresh, and realm setup retry behavior.'
    ]
  },
  {
    version: '0.6.5',
    items: [
      'Added player addon inventory and removed automatic required-addon synchronization so custom addons stay under player control.'
    ]
  },
  {
    version: '0.6.4',
    items: [
      'Improved download, verification, preparation, cancellation, resume, and progress handling.'
    ]
  },
  {
    version: '0.6.3',
    items: [
      'Introduced automatic required-addon installation; this behavior was later removed in version 0.6.5.'
    ]
  },
  {
    version: '0.6.2',
    items: [
      'Added launcher file ownership tracking and safer preservation during install, upgrade, and uninstall.'
    ]
  },
  {
    version: '0.6.1',
    items: [
      'Improved folder selection and installation flow, preserved MemoryBridge.log, and smoothed the transition from updating to ready to play.'
    ]
  }
];
const emptyConfig = { name: 'CoA Custom Races', links: {} };
const defaultSettings = { language: 'en', languageSelected: false, startPage: 'home', launchBehavior: 'close', autoLaunchAfterUpdate: true, addonCleanupDismissed: false, rememberClient: true, hdPatches: true, wineCompatibility: false, autoLoginGame: false, downloadLimitMBps: 0, graphicsCompatibility: false, disableGraphicsEnhancements: false, reducedMotion: false, sound: true, installPath: '' };
let previewSettings;
try { previewSettings = { ...defaultSettings, ...JSON.parse(localStorage.getItem('conquest-preview-settings') || '{}') }; } catch { previewSettings = { ...defaultSettings }; }
const api = window.launcher || {
  bootstrap: async () => ({ config: emptyConfig, settings: previewSettings, client: { installed: false, running: false, path: '' }, version: '0.2.0' }),
  window: async action => { if (action === 'maximize' && !document.fullscreenElement) await document.documentElement.requestFullscreen(); else if (action === 'maximize') await document.exitFullscreen(); else toast(t('Window controls work in the desktop launcher.')); },
  saveSettings: async patch => { Object.assign(previewSettings, patch); if (Object.hasOwn(patch, 'language')) previewSettings.languageSelected = true; localStorage.setItem('conquest-preview-settings', JSON.stringify(previewSettings)); return previewSettings; },
  chooseClient: async () => { throw new Error(t('Open the desktop launcher to select a client folder.')); },
  clientInfo: async () => ({ installed: false, running: false, path: '' }),
  launch: async () => { throw new Error(t('Select a client in the desktop launcher first.')); },
  openFolder: async () => { throw new Error(t('Select a client in the desktop launcher first.')); },
  external: async () => { throw new Error(t('This service has not been connected yet.')); },
  account: async () => null,
  legalNotices: async () => { throw new Error(t('Open the installed desktop launcher to read the bundled license files.')); },
  login: async () => { throw new Error(t('Account login is available in the desktop launcher.')); },
  register: async () => { throw new Error(t('Account registration is available in the desktop launcher.')); },
  accountOverview: async () => { throw new Error(t('Account management is available in the desktop launcher.')); },
  accountCharacters: async () => [],
  coaNetwork: async () => ({ lan: ['192.168.1.20'], hamachi: ['25.10.20.30'] }),
  coaOpen: async key => { window.open({ coffee: 'https://buymeacoffee.com/ilusixne', duff: 'https://github.com/Duff-SPP/ConquestOfAzerothCoreLauncher' }[key] || 'about:blank'); },
  coaSetRealm: async (mode, address) => { Object.assign(previewSettings, { realmMode: mode, realmlist: address }); return { realmlist: address, server: 'preview' }; },
  logout: async () => {},
  databaseView: async () => ({ visible: false }),
  reloadDatabase: async () => {},
  issues: async () => [],
  openIssue: async () => { throw new Error(t('Issue links open in the desktop launcher.')); },
  submitBug: async () => { throw new Error(t('Bug submission is available in the desktop launcher.')); },
  addons: async () => ({ packages: [], folderCount: 0 }),
  installAddon: async () => { throw new Error(t('Addon installation is available in the desktop launcher.')); },
  uninstallAddon: async () => { throw new Error(t('Addon management is available in the desktop launcher.')); },
  openAddonsFolder: async () => { throw new Error(t('Select a client in the desktop launcher first.')); },
  onDatabaseStatus: () => () => {},
  onGameExit: () => () => {},
};
const state = {
  page: 'home', newsTab: 'latest', settingsTab: 'launcher', addonTab: 'browse',
  config: emptyConfig, settings: defaultSettings, client: { installed: false, path: '', running: false }, version: '0.2.0',
  issues: [], issuesLoading: false, issuesError: '', issueQuery: '', databaseStatus: 'loading', databaseMessage: '',
  addons: [], addonLoading: false, addonError: '', addonQuery: '', addonCategory: 'all', addonFolderCount: 0,
  account: null, accountOverview: null, accountCharacters: []
};
const main = document.getElementById('main-content');
const modal = document.getElementById('modal');
const modalContent = document.getElementById('modal-content');
const popoverRoot = document.getElementById('popover-root');
let toastTimer;
let lastModalFocus = null;
function toast(message) {
  clearTimeout(toastTimer);
  const element = document.getElementById('toast');
  element.textContent = tm(message); element.hidden = false;
  toastTimer = setTimeout(() => { element.hidden = true; }, 5500);
}
async function guarded(action) {
  try { return await action(); }
  catch (error) {
    const message = tm(error.message) || t('Something went wrong.');
    if (modal.open) {
      let notice = modalContent.querySelector('[data-modal-error]');
      if (!notice) {
        notice = document.createElement('div'); notice.className = 'info-box';
        notice.dataset.modalError = ''; notice.setAttribute('role', 'alert');
        (modalContent.querySelector('.modal-body') || modalContent).prepend(notice);
      }
      notice.textContent = message;
    } else toast(message);
    return null;
  }
}
function openModal(content, className = '') {
  popoverRoot.innerHTML = '';
  if (isEmbeddedPage()) api.databaseView({ visible: false }).catch(() => {});
  if (!modal.open) lastModalFocus = document.activeElement;
  modal.className = className; modalContent.innerHTML = content; fillIcons(modalContent);
  if (!modal.open) modal.showModal();
  modal.querySelector('.modal-close')?.focus();
}
function closeModal() {
  if (modal.classList.contains('first-language-dialog') && !state.settings.languageSelected) return;
  modal.close();
  if (isEmbeddedPage()) requestAnimationFrame(syncDatabaseView);
}
modal.addEventListener('cancel', event => { if (modal.classList.contains('first-language-dialog') && !state.settings.languageSelected) event.preventDefault(); });
modal.addEventListener('close', () => {
  // Destroy modal content when closed.
  // This stops embedded media such as YouTube immediately.
  modalContent.innerHTML = '';

  if (lastModalFocus?.isConnected) {
    lastModalFocus.focus();
  }

  if (isEmbeddedPage()) {
    requestAnimationFrame(syncDatabaseView);
  }
});
modal.addEventListener('click', event => { if (event.target === modal) { const bounds = modal.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeModal(); } });
const modalHeader = (title, subtitle = '') => lh`<div class="modal-header"><div><h2 id="modal-title">${escape(title)}</h2>${subtitle ? lh`<p>${escape(subtitle)}</p>` : ''}</div><button class="modal-close" data-action="dismiss-modal" aria-label="Close dialog">×</button></div>`;
const titleBlock = (title, description = '', badge = '') => lh`<div class="page-topline"><div><div class="eyebrow">CoA Custom Races</div><h1 class="page-title">${title}</h1>${description ? lh`<p class="page-description">${description}</p>` : ''}</div>${badge ? lh`<span class="page-tag">${badge}</span>` : ''}</div>`;
function newsCard(article) { return lh`<button class="news-card" data-article="${article.id}"><div class="news-art"><img src="assets/${article.image}" alt="" loading="eager"><span class="news-category">${t(article.category)}</span></div><div class="news-copy"><div class="news-date">CoA Custom Races</div><h3>${t(article.title)}</h3><p>${t(article.summary)}</p></div></button>`; }
function changelogHtml() {
  return lh`<div class="changelog-history"><p class="changelog-intro">${t('Release history from version 0.6.1 onward.')}</p>${changelogEntries.map(entry => lh`<div class="changelog-item"><small>LAUNCHER · v${escape(entry.version)}</small><h3>${lt`Version ${entry.version}`}</h3><ul class="changelog-list">${entry.items.map(item => lh`<li>${t(item)}</li>`).join('')}</ul></div>`).join('')}</div>`;
}
function homePage() {
  const installed = state.client.installed;
  return lh`<div class="home-page"><section class="hero-grid"><div class="hero-copy"><div class="eyebrow">Your world. Your adventure.</div><h1>CoA Custom<br>Races</h1><p class="hero-description">Return to the world that started it all.<br>Begin your next chapter in Azeroth.</p><div class="client-controls"><div class="client-label"><span>CoA Custom Races</span><span>${installed ? t('Client selected') : 'World of Warcraft'}</span></div><div class="play-row"><button class="play-button" data-action="play">${icon(installed ? 'play' : 'download')}<span class="play-text"><span class="play-title">${state.client.running ? t('Playing') : installed ? t('Play') : t('Download')}</span><span class="play-subtitle">${state.client.running ? t('Your adventure is underway') : installed ? t('Enter Azeroth') : t('Begin your adventure')}</span></span></button><button class="play-options" data-action="play-options" aria-label="Game options">⌄</button></div><label class="hd-patches-option"><input type="checkbox" data-setting="hdPatches" ${state.settings.hdPatches !== false ? 'checked' : ''}><span>${t('Enable HD patches')}</span></label><span class="hd-patches-hint">${t('Applies on your next launch.')}</span><button class="locate-client" data-action="choose-client">${icon('folder')}${installed ? launcherI18n.html('<span>Change game location</span>') : launcherI18n.html('Already installed? <span>Locate game</span>')}</button>${coaPanelHtml()}</div></div><aside class="hero-side"><button class="coffee-card" data-action="coa-coffee"><span class="coffee-cup">☕</span><span><strong>Buy me a coffee</strong><small>Support ilusixn and CoA Custom Races</small></span>${icon('external')}</button><fieldset class="trailer-panel"><legend>A world of adventure</legend><button class="trailer-button" data-action="trailer" aria-label="Watch the trailer"><img src="assets/trailer.jpg" alt="A dragon above a burning Azeroth landscape"><span class="trailer-play"><span>${icon('play')}</span></span><span class="trailer-caption">YOUR NEXT CHAPTER AWAITS</span></button></fieldset><button class="discord-card" data-action="coa-link" data-link="races"><span class="discord-crest discord-crest-image"><img src="assets/coa-custom-emblem.png" alt=""></span><span class="discord-name">CoA Custom Races<span><small>Releases, races and credits</small></span></span><span class="discord-link">GITHUB ${icon('external')}</span></button></aside></section><section class="news-section"><div class="section-heading"><h2>Latest news</h2><span class="heading-rule"></span><button data-page="news">View all news ${icon('arrow')}</button></div><div class="news-grid">${articles.map(newsCard).join('')}</div></section></div>`;
}
// ---- CoA Custom Races: server, modules, realmlist ----
const realmLabels = { local: 'Local (this PC)', lan: 'LAN', hamachi: 'LogMeIn Hamachi', custom: 'Join a friend' };
function coaPanelHtml() {
  const s = state.settings;
  const server = s.serverPath ? lh`<span class="coa-path" title="${escape(s.serverPath)}">${escape(s.serverPath)}</span>` : lh`<span class="coa-path">${t('No server yet')}</span>`;
  const mods = ['squid', 'devMenu', 'races'].filter(k => s.modules?.[k]).map(k => ({ squid: 'SquidBots', devMenu: 'Dev Menu', races: 'Custom Races V2' })[k]).join(' · ') || t('No modules');
  return lh`<div class="coa-panel"><div class="coa-row"><span class="coa-title">${icon('database')}Server</span>${server}</div><div class="coa-buttons">${s.serverPath ? lh`<button class="secondary-button" data-action="coa-start">${icon('play')}Start</button><button class="secondary-button" data-action="coa-stop">Stop</button>` : lh`<button class="gold-button" data-action="coa-create">${icon('download')}Create server</button><button class="secondary-button" data-action="coa-locate">${icon('folder')}Locate</button>`}</div><div class="coa-row"><span class="coa-title">${icon('addons')}Modules</span><span class="coa-path">${escape(mods)}</span></div><div class="coa-buttons"><button class="gold-button" data-action="coa-modules">Apply modules</button>${s.serverPath ? lh`<button class="secondary-button" data-action="coa-accounts">${icon('user')}Accounts</button>` : ''}<button class="secondary-button" data-action="coa-backups">${icon('shield')}Backups</button><button class="secondary-button" data-action="coa-trouble">${icon('info')}Troubleshoot</button><button class="secondary-button" data-action="coa-realm">${icon('globe')}Realmlist: ${escape(realmLabels[s.realmMode] || 'Local')}</button></div><div id="coa-status" class="coa-status" role="status">${escape(state.coaStatus || '')}</div></div>`;
}
function showModules() {
  const m = state.settings.modules || {};
  const row = (key, title, text, link) => lh`<label class="setting-row"><span><span class="setting-title">${title}</span><span class="setting-description">${text} <button class="link-button" data-action="coa-link" data-link="${link}">${t('More')}</button></span></span><input class="switch" type="checkbox" data-module="${key}" ${m[key] ? 'checked' : ''}></label>`;
  openModal(lh`${modalHeader(t('Apply modules'), t('Choose what goes on your server and client'))}<div class="modal-body">${row('squid', 'SquidBots (SQUID Playerbots)', t('AI players for your world. Always the latest version shipped with the server, plus the latest SquidBots addon. Off = no bots.'), 'squid')}${row('devMenu', 'ilusixn Dev Menu', t('In-game /dev editor addon (NPCs, items, quests). Its server part needs a worldserver built with the module.'), 'devmenu')}${row('races', 'CoA Custom Races V2', t('80+ custom races: turns races on in your server and installs the V2 client files (about 8.6 GB download). Starts with CoACustomRace.exe.'), 'races')}<div class="info-box">${icon('info')}<span>${t('Close the game first. Unchecking a module turns it off on the server; files already installed stay.')}</span></div></div><div class="modal-footer"><button class="secondary-button" data-action="dismiss-modal">${t('Cancel')}</button><button class="gold-button" data-action="coa-apply">${t('Apply')}</button></div>`);
}
async function showRealm() {
  const net = await api.coaNetwork().catch(() => ({ lan: [], hamachi: [] }));
  const s = state.settings;
  const option = (mode, title, text, value) => lh`<label class="realm-option"><input type="radio" name="realm-mode" value="${mode}" data-address="${escape(value || '')}" ${s.realmMode === mode ? 'checked' : ''}><span><span class="setting-title">${title}</span><span class="setting-description">${text}</span></span></label>`;
  const lan = net.lan[0] || ''; const ham = net.hamachi[0] || '';
  openModal(lh`${modalHeader(t('Realmlist'), t('How players reach your server'))}<div class="modal-body">${option('local', t('Local'), t('Only this PC plays (127.0.0.1).'), '127.0.0.1')}${option('lan', t('LAN play'), lan ? `${t('Players on your home network join')} ${lan}` : t('No LAN address found on this PC.'), lan)}${option('hamachi', 'LogMeIn Hamachi', ham ? `${t('Friends in your Hamachi network join')} ${ham}` : t('Hamachi is not running. Install and join a network first.'), ham)}${option('custom', t('Join a friend'), t('Play on someone else\'s server: enter their LAN or Hamachi IP.'), s.realmMode === 'custom' ? s.realmlist : '')}<label class="form-label" for="realm-address">${t('Address')}</label><input type="text" id="realm-address" value="${escape(s.realmlist || '127.0.0.1')}" spellcheck="false"><div class="info-box">${icon('info')}<span>${t('Hosting? Friends set "Join a friend" with your address. Allow worldserver and authserver through Windows Firewall (ports 3724 and 8085).')} <button class="link-button" data-action="coa-link" data-link="hamachi">LogMeIn Hamachi</button></span></div></div><div class="modal-footer"><button class="secondary-button" data-action="dismiss-modal">${t('Cancel')}</button><button class="gold-button" data-action="coa-realm-save">${t('Save')}</button></div>`);
}
function formatSize(bytes) { return bytes > 2 ** 30 ? (bytes / 2 ** 30).toFixed(2) + ' GB' : (bytes / 2 ** 20).toFixed(1) + ' MB'; }
const backupReasons = { manual: 'Manual', 'before-update': 'Before a server update', 'before-restore': 'Before a restore' };
async function showBackups(notice = '') {
  if (!state.settings.serverPath) { toast(t('Create or locate your server first.')); return; }
  let list = [];
  try { list = await api.coaBackups(); } catch (error) { toast(tm(error.message)); return; }
  const rows = list.length ? list.map(b => lh`<div class="backup-row"><span><strong>${escape(b.when)}</strong><small>${escape(t(backupReasons[b.reason] || b.reason))} · ${escape(formatSize(b.size))}</small></span><button class="secondary-button" data-action="coa-restore-ask" data-name="${escape(b.name)}">${t('Restore')}</button></div>`).join('') : lh`<div class="backup-empty">${t('No backups yet.')}</div>`;
  openModal(lh`${modalHeader(t('Character backups'), t('Characters, accounts and guilds. Saved automatically before every server update.'))}<div class="modal-body"><p class="backup-notice" id="backup-notice">${escape(notice)}</p><div class="backup-list">${rows}</div><div class="info-box">${icon('info')}<span>${t('Restoring replaces every character and account with the backup. Your current state is saved first, and the server is stopped.')}</span></div></div><div class="modal-footer"><button class="secondary-button" data-action="coa-backup-folder">${t('Open folder')}</button><button class="gold-button" data-action="coa-backup-now">${t('Back up now')}</button></div>`, 'backup-dialog');
}
async function showTroubleshoot() {
  openModal(lh`${modalHeader(t('Troubleshoot'), t('Checking your client, server, database and network…'))}<div class="modal-body"><p class="backup-notice">${t('Running checks, this takes a few seconds.')}</p></div>`, 'backup-dialog');
  let checks;
  try { checks = await api.coaTroubleshoot(); } catch (error) { closeModal(); toast(tm(error.message)); return; }
  const bad = checks.filter(c => c.ok === false).length; const warn = checks.filter(c => c.ok === 'warn').length;
  const mark = c => c.ok === true ? '✔' : c.ok === 'warn' ? '!' : '✖';
  const cls = c => c.ok === true ? 'ok' : c.ok === 'warn' ? 'warn' : 'fail';
  const groups = [...new Set(checks.map(c => c.group))];
  const body = groups.map(g => lh`<h4 class="check-group">${escape(g)}</h4>${checks.filter(c => c.group === g).map(c => lh`<div class="check-row ${cls(c)}"><span class="check-mark">${mark(c)}</span><span><strong>${escape(c.name)}</strong><small>${escape(c.detail)}</small>${c.ok !== true && c.fix ? lh`<small class="check-fix">${t('Fix')}: ${escape(c.fix)}</small>` : ''}</span></div>`).join('')}`).join('');
  const summary = bad ? lt`${bad} problem(s) found` : warn ? lt`No problems, ${warn} note(s)` : t('Everything looks fine');
  openModal(lh`${modalHeader(t('Troubleshoot'), summary)}<div class="modal-body check-list">${body}</div><div class="modal-footer"><button class="secondary-button" data-action="coa-trouble">${t('Run again')}</button><button class="gold-button" data-action="dismiss-modal">${t('Done')}</button></div>`, 'backup-dialog');
}
async function coaRun(label, action) {
  state.coaBusy = true; state.coaStatus = label; render();
  try { return await action(); } finally { state.coaBusy = false; }
}
// ---- CoA Custom Races pages: Updates, Races, Bots ----
async function showAccounts(notice = '') {
  openModal(lh`${modalHeader(t('Game accounts'), t('Create the login you use to enter the game on your server.'))}<div class="modal-body"><label class="form-label" for="acc-name">${t('Account name')}</label><input type="text" id="acc-name" maxlength="16" spellcheck="false" autocomplete="off"><label class="form-label" for="acc-pass">${t('Password')}</label><input type="password" id="acc-pass" maxlength="16" autocomplete="new-password"><label class="setting-row"><span><span class="setting-title">${t('Game master (GM) account')}</span><span class="setting-description">${t('Needed for the /dev menu and GM commands.')}</span></span><input class="switch" type="checkbox" id="acc-gm" checked></label><div class="info-box">${icon('info')}<span id="acc-notice">${escape(notice) || t('Names and passwords are not case sensitive. Stored on your own server only.')}</span></div><div id="acc-list" class="acc-list"></div></div><div class="modal-footer"><button class="secondary-button" data-action="dismiss-modal">${t('Close')}</button><button class="gold-button" data-action="coa-account-create">${t('Create account')}</button></div>`, 'backup-dialog');
  api.coaAccounts().then(list => { const box = document.getElementById('acc-list'); if (box) box.textContent = list.length ? t('Existing accounts') + ': ' + list.join(', ') : ''; }).catch(() => {});
}
const moduleNames = { server: 'CoA server', squid: 'SquidBots addon', devMenu: 'ilusixn Dev Menu', races: 'CoA Custom Races' };
const moduleRepos = { server: 'Corfirean/coa-server-build', squid: 'Zyth45/squidbots-addon', devMenu: 'ilusixn/ilusixn-dev-menu', races: 'ilusixn/CustomRacesCoa' };
function raceIdsText(race) { return race.ids.join(' / '); }
function updatesPage() {
  const u = state.coaUpdates;
  const row = key => {
    const installed = u?.installed?.[key] || ''; const latest = u?.latest?.[key] || '';
    const active = key === 'server' ? !!u?.server : key === 'squid' ? u?.modules?.squid : u?.modules?.[key];
    const status = !u ? t('Checking…') : !active ? t('Not installed') : !latest ? t('Unavailable') : installed === latest ? t('Up to date') : installed ? t('Update available') : t('Version unknown');
    const canUpdate = u && active && latest && installed !== latest;
    return lh`<div class="update-row"><div><strong>${escape(moduleNames[key])}</strong><small>${escape(moduleRepos[key])}</small></div><span>${escape(installed || '—')}</span><span>${escape(latest || '—')}</span><span class="update-status ${canUpdate ? 'pending' : ''}">${status}</span><button class="${canUpdate || (!active && key !== 'server') ? 'gold-button' : 'secondary-button'}" data-action="${!active && key !== 'server' ? 'coa-modules' : 'coa-update'}" data-key="${key}" ${active || key !== 'server' ? '' : 'disabled'}>${!active && key !== 'server' ? t('Install') : canUpdate ? t('Update') : t('Reinstall')}</button></div>`;
  };
  return lh`<div class="content-page">${titleBlock(t('Updates'), t('Your server, client and modules, straight from their GitHub releases.'), 'CONNECTED TO GITHUB')}<div class="update-table"><div class="update-row update-head"><span>${t('Part')}</span><span>${t('Installed')}</span><span>${t('Latest')}</span><span>${t('Status')}</span><span></span></div>${row('server')}<div class="update-row"><div><strong>${t('Game client')}</strong><small>Conquest of AzerothCore client service</small></div><span>—</span><span>—</span><span class="update-status">${t('Checked on every launch')}</span><button class="secondary-button" data-action="coa-check-client">${t('Check now')}</button></div>${row('races')}${row('squid')}${row('devMenu')}</div><div class="info-box">${icon('info')}<span>${t('Updating the server stops it, replaces its program files, keeps your characters and settings, and applies the new database updates once. SquidBots itself is part of the server, so a server update also updates the bots.')}</span></div><div class="button-row"><button class="secondary-button" data-action="coa-refresh-updates">${icon('refresh')}${t('Check again')}</button></div><div class="danger-zone"><strong>${t('Remove')}</strong><span>${t('Deleting cannot be undone.')}</span><button class="secondary-button danger-button" data-action="coa-delete-server-ask" ${state.settings.serverPath ? '' : 'disabled'}>${t('Delete server')}</button><button class="secondary-button danger-button" data-action="coa-delete-client-ask">${t('Delete game client')}</button></div><div id="coa-status" class="coa-status" role="status">${escape(state.coaStatus || '')}</div></div>`;
}
async function loadUpdates() {
  try { state.coaUpdates = await api.coaUpdates(); } catch (error) { state.coaUpdates = { failed: true }; toast(tm(error.message)); }
  if (state.page === 'updates') render();
}
function racesPage() {
  const query = (state.raceQuery || '').toLowerCase();
  const races = (state.coaRaces || []).filter(r => !query || `${r.name} ${r.side} ${r.credit} ${raceIdsText(r)}`.toLowerCase().includes(query));
  const body = !state.coaRaces ? lh`<p class="page-description">${t('Loading the race list…')}</p>` : lh`<div class="race-table"><div class="race-row race-head"><span>Id</span><span>${t('Race')}</span><span>${t('Side')}</span><span>${t('Credit')}</span></div>${races.map(r => lh`<div class="race-row"><span class="race-id">${escape(raceIdsText(r))}</span><span><strong>${escape(r.name)}</strong>${r.notes ? lh`<small>${escape(r.notes)}</small>` : ''}</span><span>${escape(r.side)}</span><span>${escape(r.credit)}</span></div>`).join('')}</div>`;
  return lh`<div class="content-page">${titleBlock(t('Playable races'), lt`${state.coaRaces ? state.coaRaces.length : '…'} races with their ChrRaces ids. Pairs like 68/69 are the Alliance/Horde twins.`, 'COA CUSTOM RACES')}<div class="filter-bar"><label class="search-box">${icon('search')}<input id="race-search" type="text" placeholder="${t('Search races, ids or credits')}" value="${escape(state.raceQuery || '')}"></label></div><div id="race-results">${body}</div></div>`;
}
async function loadRaces() {
  if (state.coaRaces) return;
  try { state.coaRaces = await api.coaRaces(); } catch (error) { toast(tm(error.message)); state.coaRaces = []; }
  if (['races', 'bots'].includes(state.page)) render();
}
function botsPage() {
  if (!state.settings.serverPath) return lh`<div class="content-page">${titleBlock(t('Bot races'), t('Choose which races SquidBots spawn as.'))}<div class="empty-panel"><h2>${t('No server yet')}</h2><p>${t('Create or locate your server on the Home page first.')}</p></div></div>`;
  const bots = state.coaBotRaces;
  const excluded = new Set(bots?.excluded || []); const crashing = new Set(bots?.crashing || []);
  const cards = (state.coaRaces || []).filter(r => !/skyborne/i.test(r.name)).map(r => {
    const blocked = r.ids.every(id => crashing.has(id));
    const on = !blocked && r.ids.some(id => !excluded.has(id));
    return lh`<label class="bot-race ${blocked ? 'blocked' : ''}"><input type="checkbox" data-bot-race="${r.ids.join(',')}" ${on ? 'checked' : ''} ${blocked ? 'disabled' : ''}><span><strong>${escape(r.name)}</strong><small>${escape(raceIdsText(r))} · ${escape(r.side)}${blocked ? ' · ' + t('crashes bots, always off') : ''}</small></span></label>`;
  }).join('');
  return lh`<div class="content-page">${titleBlock(t('Bot races'), t('Checked races are the ones SquidBots spawn as. Saved to your server; new bots use it after a server restart.'), state.settings.modules?.squid ? 'SQUIDBOTS ON' : 'SQUIDBOTS OFF')}<div class="button-row"><button class="secondary-button" data-action="coa-bots-all">${t('Select all')}</button><button class="secondary-button" data-action="coa-bots-none">${t('Unselect all')}</button><button class="gold-button" data-action="coa-bots-save">${t('Save')}</button></div>${!bots || !state.coaRaces ? lh`<p class="page-description">${t('Loading…')}</p>` : lh`<div class="bot-grid">${cards}</div>`}</div>`;
}
async function loadBotRaces() {
  await loadRaces();
  try { state.coaBotRaces = await api.coaBotRaces(); } catch (error) { toast(tm(error.message)); state.coaBotRaces = { excluded: [], crashing: [] }; }
  if (state.page === 'bots') render();
}
function newsPage() {
  return lh`<div class="content-page">${titleBlock(t('News & updates'), t('The latest from your world. Announcements, development, and community stories.'), 'CONQUEST OF AZEROTHCORE')}<div class="tabs" role="tablist" aria-label="News categories"><button role="tab" aria-selected="${state.newsTab === 'latest'}" class="tab ${state.newsTab === 'latest' ? 'active' : ''}" data-news-tab="latest">Latest news</button><button role="tab" aria-selected="${state.newsTab === 'changelog'}" class="tab ${state.newsTab === 'changelog' ? 'active' : ''}" data-news-tab="changelog">Changelog</button></div>${state.newsTab === 'latest' ? lh`<div class="news-page-grid">${articles.map(newsCard).join('')}</div>` : changelogHtml()}</div>`;
}
const services = {
  store: { title: 'Store', description: 'Discover what your project has to offer.', icon: 'store', heading: 'Your store, right here', body: 'The store will connect to your CoA Custom Races website. Products and account balances will appear when your store service is ready.', action: 'Open store' },
  wiki: { title: 'Wiki', heading: 'Knowledge for your journey', body: 'Guides, getting started, and project information will open on your own wiki.', icon: 'book', action: 'Open wiki' },
  discord: { title: 'Join the community', heading: 'Your adventure is better together', body: 'Join the CoA Custom Races Discord community.', icon: 'discord', action: 'Open Discord' },
  support: { title: 'Support', heading: 'A helping hand', body: 'Visit our support page for help with your account or client.', icon: 'shield', action: 'Open support' },
  register: { title: 'Create an account', heading: 'Start your journey', body: 'Create your game account in the desktop launcher.', icon: 'user', action: 'Create account' }
};
function servicePage(key) {
  const service = services[key];
  const connected = !!state.config.links[key];
  return lh`<div class="content-page">${titleBlock(t(service.title), t(service.description) || t(service.body))}<div class="empty-panel"><span class="empty-emblem">${icon(service.icon)}</span><h2>${t(service.heading)}</h2><p>${t(service.body)}</p><button class="gold-button" data-external="${key}" ${connected ? '' : 'disabled'}>${t(service.action)} ${icon('external')}</button><div class="service-details"><span>Project service</span><span>${connected ? t('Connected') : t('Not connected yet')}</span></div></div>${key === 'store' ? launcherI18n.html('<div class="feature-row"><div class="feature-tile">') + icon('user') + launcherI18n.html('<h3>Your account</h3><p>Your own project identity and purchase history.</p></div><div class="feature-tile">') + icon('store') + launcherI18n.html('<h3>Your catalog</h3><p>Products and availability from your project.</p></div><div class="feature-tile">') + icon('shield') + launcherI18n.html('<h3>Your checkout</h3><p>Payments handled by your connected website.</p></div></div>') : ''}</div>`;
}
function isEmbeddedPage() { return state.page === 'database' || state.page === 'armory'; }
function databasePage() {
  if (state.page === 'armory') return armoryPage();
  const embedded = !!window.launcher;
  return lh`<div class="content-page database-page">${titleBlock(t('Database'), t('Explore items, spells, quests, creatures, and discoveries without leaving the launcher.'), t('LIVE DATABASE'))}<div class="database-toolbar"><span class="database-state" id="database-status">${icon('database')}<span>${embedded ? t('Connecting to Ascension Database…') : t('Desktop launcher required for embedded browsing')}</span></span><div class="button-row"><button class="secondary-button" data-action="database-reload" ${embedded ? '' : 'disabled'}>${icon('refresh')}Reload</button><button class="secondary-button" data-external="database">${icon('external')}Open in browser</button></div></div><div class="database-frame"><div class="database-placeholder">${icon('database')}<strong>Ascension Database</strong><span>${embedded ? t('Loading the live database…') : t('The native embedded browser appears here in the desktop launcher.')}</span></div><div class="database-viewport" id="database-viewport" aria-label="Embedded Ascension Database"></div></div></div>`;
}
function armoryPage() {
  const embedded = !!window.launcher;
  return lh`<div class="content-page database-page">${titleBlock(t('Armory'))}<div class="database-toolbar"><span class="database-state" id="database-status">${icon('shield')}<span>${embedded ? t('Loading…') : t('Desktop launcher required for embedded browsing')}</span></span><div class="button-row"><button class="secondary-button" data-action="database-reload" ${embedded ? '' : 'disabled'}>${icon('refresh')}Reload</button></div></div><div class="database-frame"><div class="database-placeholder">${icon('shield')}<strong>${t('Armory')}</strong><span>${embedded ? t('Loading…') : t('The native embedded browser appears here in the desktop launcher.')}</span></div><div class="database-viewport" id="database-viewport" aria-label="Armory"></div></div></div>`;
}
const embeddedStatuses = new Map();
function formatIssueDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t('Unknown');
  return new Intl.DateTimeFormat(launcherI18n.language, { month: 'short', day: 'numeric', year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }).format(date);
}
function issueRowsHtml() {
  if (state.issuesLoading) return lh`<div class="issue-empty issue-loading">${icon('refresh')}<strong>Loading current bugs…</strong>Reading the live GitHub issue tracker.</div>`;
  if (state.issuesError) return lh`<div class="issue-empty">${icon('bug')}<strong>Could not load the bugtracker</strong>${escape(tm(state.issuesError))}<div class="issue-empty-action"><button class="secondary-button" data-action="refresh-issues">${icon('refresh')}Try again</button></div></div>`;
  const query = state.issueQuery.trim().toLowerCase();
  const issues = query ? state.issues.filter(issue => (`#${issue.number} ${issue.title} ${issue.body} ${issue.labels.join(' ')}`).toLowerCase().includes(query)) : state.issues;
  if (!issues.length) return lh`<div class="issue-empty">${icon(query ? 'search' : 'bug')}<strong>${query ? t('No matching bugs') : t('No open bugs found')}</strong>${query ? t('Try another search term.') : t('The live tracker currently has no open issues.')}</div>`;
  return issues.map(issue => lh`<button class="issue-row" data-issue-number="${issue.number}"><span class="issue-main"><span class="issue-number">#${issue.number}</span><strong>${escape(issue.title)}</strong>${issue.labels.length ? lh`<span class="issue-labels">${issue.labels.slice(0, 3).map(label => lh`<span>${escape(label)}</span>`).join('')}</span>` : ''}</span><span><span class="issue-status ${issue.state}">${escape(t(issue.state))}</span></span><span class="issue-date">${escape(formatIssueDate(issue.updatedAt))}</span></button>`).join('');
}
function bugtrackerPage() {
  return lh`<div class="content-page">${titleBlock(t('Bugtracker'), t('Help make Azeroth better. Browse the live tracker and report what you find.'), t('LIVE ISSUES'))}<div class="filter-bar"><label class="search-box">${icon('search')}<input id="bug-search" aria-label="Search issues" placeholder="Search issues..." value="${escape(state.issueQuery)}"></label><div class="button-row bug-actions"><button class="secondary-button" data-action="refresh-issues">${icon('refresh')}Refresh</button><button class="gold-button" data-action="report-bug">${icon('bug')}Report a bug</button></div></div><div class="issue-table"><div class="issue-header"><span>Issue</span><span>Status</span><span>Last updated</span></div><div id="issue-results">${issueRowsHtml()}</div></div></div>`;
}
function renderIssueResults() {
  const target = document.getElementById('issue-results');
  if (!target) return;
  target.innerHTML = issueRowsHtml();
  fillIcons(target);
}
async function loadIssues(force = false) {
  if (state.issuesLoading) return;
  if (!force && state.issues.length) { renderIssueResults(); return; }
  state.issuesLoading = true; state.issuesError = ''; renderIssueResults();
  try { state.issues = await api.issues(force); }
  catch (error) { state.issuesError = tm(error.message) || t('The issue tracker could not be loaded.'); }
  finally { state.issuesLoading = false; renderIssueResults(); }
}
function updateDatabaseStatus() {
  const target = document.getElementById('database-status');
  if (!target) return;
  const saved = embeddedStatuses.get(state.page) || { state: 'loading', message: '' };
  state.databaseStatus = saved.state; state.databaseMessage = saved.message;
  const labels = state.page === 'armory' ? { loading: t('Loading…'), ready: t('Armory'), error: state.databaseMessage || t('Could not load Armory') } : { loading: t('Loading Ascension Database…'), ready: t('Ascension Database connected'), error: state.databaseMessage || t('Database could not be loaded') };
  target.className = `database-state ${state.databaseStatus}`;
  target.innerHTML = lh`${icon(state.databaseStatus === 'error' ? 'info' : state.page === 'armory' ? 'shield' : 'database')}<span>${escape(labels[state.databaseStatus] || labels.loading)}</span>`;
}
function syncDatabaseView() {
  if (!window.launcher || !isEmbeddedPage() || modal.open) return;
  const host = document.getElementById('database-viewport');
  if (!host) return;
  const bounds = host.getBoundingClientRect();
  if (bounds.width < 100 || bounds.height < 100) return;
  guarded(async () => {
    await api.databaseView({ visible: true, page: state.page, bounds: { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height } });
  });
}
function showIssue(number) {
  const issue = state.issues.find(item => item.number === number);
  if (!issue) return;
  const body = escape(issue.body || t('No description was provided.')).replace(/\n/g, launcherI18n.html('<br>'));
  openModal(lh`${modalHeader(`#${issue.number} · ${issue.title}`, t('CoA Custom Races bugtracker'))}<div class="modal-body issue-detail"><div class="issue-meta"><span class="issue-status ${issue.state}">${escape(t(issue.state))}</span><span>Updated ${escape(formatIssueDate(issue.updatedAt))}</span>${issue.author ? lh`<span>Reported by ${escape(issue.author)}</span>` : ''}<span>Comments: ${issue.comments}</span></div><div class="issue-body">${body}</div></div><div class="modal-footer"><button class="secondary-button" data-action="dismiss-modal">Back</button><button class="gold-button" data-action="open-issue" data-issue-open="${issue.number}">${icon('external')}Open on GitHub</button></div>`, 'issue-dialog');
}
function showBugReport() {
  const direct = !!state.config.bugtracker?.submitUrl;
  openModal(lh`${modalHeader(t('Report a bug'), t('CoA Custom Races bugtracker'))}<div class="modal-body"><div class="report-grid"><label class="report-field report-wide"><span>Title</span><input id="report-title" type="text" maxlength="200" placeholder="Short summary of the problem"></label><label class="report-field"><span>Category</span><select id="report-category"><option value="Gameplay">Gameplay</option><option value="Class / Spell">Class / Spell</option><option value="Quest">Quest</option><option value="Item">Item</option><option value="Creature / NPC">Creature / NPC</option><option value="Dungeon / Raid">Dungeon / Raid</option><option value="UI / Addon">UI / Addon</option><option value="Performance / Crash">Performance / Crash</option><option value="Other">Other</option></select></label><label class="report-field"><span>Severity</span><select id="report-severity"><option value="Minor">Minor</option><option value="Normal" selected>Normal</option><option value="Major">Major</option><option value="Gamebreaking">Gamebreaking</option></select></label><label class="report-field report-wide"><span>What happened?</span><textarea id="report-issue" maxlength="7000" rows="5" placeholder="Describe the bug clearly and include anything that may help reproduce it."></textarea></label><label class="report-field"><span>Expected outcome</span><textarea id="report-expected" maxlength="2500" rows="3" placeholder="What should happen?"></textarea></label><label class="report-field"><span>Actual outcome</span><textarea id="report-actual" maxlength="2500" rows="3" placeholder="What happened instead?"></textarea></label><label class="report-field report-wide"><span>Steps to reproduce</span><textarea id="report-steps" maxlength="2500" rows="3" placeholder="1. …&#10;2. …&#10;3. …"></textarea></label></div><div class="info-box">${icon('shield')}<span>${direct ? t('Your report will be sent directly to the CoA Custom Races bugtracker.') : t('Your report will open prefilled in the public bugtracker. Review it there and submit when you are ready.')}</span></div></div><div class="modal-footer"><button class="secondary-button" data-action="dismiss-modal">Cancel</button><button class="gold-button" data-action="submit-bug" id="submit-bug-button">${icon('bug')}${direct ? t('Submit report') : t('Continue to GitHub')}</button></div>`, 'report-dialog');
}
async function submitBugForm() {
  const title = document.getElementById('report-title')?.value.trim() || '';
  const issue = document.getElementById('report-issue')?.value.trim() || '';
  if (title.length < 3) { toast(t('Give the bug a short title first.')); document.getElementById('report-title')?.focus(); return; }
  if (!issue) { toast(t('Describe what happened before submitting.')); document.getElementById('report-issue')?.focus(); return; }
  const button = document.getElementById('submit-bug-button');
  if (button) button.disabled = true;
  try {
    const result = await api.submitBug({
      title,
      category: document.getElementById('report-category')?.value || t('Other'),
      severity: document.getElementById('report-severity')?.value || t('Normal'),
      issue,
      expected: document.getElementById('report-expected')?.value || '',
      actual: document.getElementById('report-actual')?.value || '',
      steps: document.getElementById('report-steps')?.value || '',
    });
    closeModal();
    if (result.mode === 'submitted') {
      toast(lt`Bug #${result.number} was submitted successfully.`);
      state.issues = []; await loadIssues(true);
    } else toast(t('Your report is prefilled on GitHub. Review it there and submit the issue.'));
  } finally { if (button?.isConnected) button.disabled = false; }
}
function addonStatus(addon) {
  if (addon.status === 'unknown') return { label: t('Not in catalog'), className: 'partial' };
  if (addon.status === 'unreadable') return { label: t('Cannot inspect'), className: 'partial' };
  if (addon.status === 'installed') return { label: t('Catalog files match'), className: 'installed' };
  if (addon.status === 'update') return { label: t('Differs from catalog'), className: 'update' };
  if (addon.status === 'partial') return { label: t('Missing catalog files'), className: 'partial' };
  return { label: t('Available'), className: 'available' };
}
function filteredAddons() {
  const query = state.addonQuery.trim().toLowerCase();
  return state.addons.filter(addon => {
    if (state.addonTab === 'browse' && addon.catalog === false) return false;
    if (state.addonTab === 'installed' && addon.status === 'not-installed') return false;
    if (state.addonCategory !== 'all' && addon.category !== state.addonCategory) return false;
    if (!query) return true;
    return `${addon.name} ${addon.description} ${addon.category} ${addon.folders.join(' ')}`.toLowerCase().includes(query);
  });
}
function addonCardsHtml() {
  if (state.addonLoading) return lh`<div class="addon-empty issue-loading">${icon('refresh')}<strong>Reading addon catalog…</strong><span>Scanning the addons bundled with your launcher.</span></div>`;
  if (state.addonError) return lh`<div class="addon-empty">${icon('addons')}<strong>Addon catalog could not be loaded</strong><span>${escape(tm(state.addonError))}</span><button class="secondary-button" data-action="refresh-addons">${icon('refresh')}Try again</button></div>`;
  const addons = filteredAddons();
  if (!addons.length) {
    const message = state.addonTab === 'installed' && !(state.client.addonsReady || state.client.installed) ? t('Choose your game client to scan installed addons.') : state.addonTab === 'installed' ? t('No addon folders were found in Interface/AddOns.') : t('No addons match your current filters.');
    return lh`<div class="addon-empty">${icon(state.addonTab === 'installed' ? 'folder' : 'search')}<strong>${state.addonTab === 'installed' ? t('No addon folders found') : t('No matching addons')}</strong><span>${message}</span>${!(state.client.addonsReady || state.client.installed) ? lh`<button class="gold-button" data-action="choose-client">${icon('folder')}Locate game client</button>` : ''}</div>`;
  }
  return addons.map(addon => {
    const status = addonStatus(addon);
    const installed = addon.status !== 'not-installed';
    const actionLabel = addon.status === 'update' ? t('Use catalog version') : addon.status === 'partial' ? t('Repair') : installed ? t('Repair') : t('Install');
    const disabled = addon.managementBlocked || !(state.client.addonsReady || state.client.installed) || state.client.running ? 'disabled' : '';
    const modules = addon.folders.length === 1 ? t('1 addon folder') : lt`${addon.folders.length} addon folders`;
    const shownVersion = addon.catalog === false ? addon.installedVersion : addon.version;
    const version = shownVersion ? `v${escape(shownVersion)}` : t('Version not listed');
    return lh`<article class="addon-card"><div class="addon-card-top"><div class="addon-emblem">${icon('addons')}</div><div class="addon-card-heading"><div class="addon-name-row"><h3>${escape(addon.name)}${addon.mandatory ? ' · ' + t('Mandatory') : ''}</h3><span class="addon-status ${status.className}">${escape(status.label)}</span></div><div class="addon-meta"><span>${escape(addon.category)}</span><span>·</span><span>${version}</span><span>·</span><span>${modules}</span></div></div></div><p>${escape(tm(addon.description))}</p><div class="addon-card-footer"><button class="ghost-button addon-details-button" data-addon-details="${escape(addon.id)}">Details</button><div class="addon-card-actions">${installed && addon.managed && !addon.mandatory ? lh`<button class="ghost-button danger-soft" data-addon-uninstall="${escape(addon.id)}" ${disabled}>Uninstall</button>` : ''}${addon.catalog !== false && (!installed || addon.managed) ? lh`<button class="${installed ? 'secondary-button' : 'gold-button'}" data-addon-install="${escape(addon.id)}" ${disabled}>${icon(installed ? 'refresh' : 'download')}${actionLabel}</button>` : ''}</div></div></article>`;
  }).join('');
}
function addonCategories() {
  return [...new Set(state.addons.map(addon => addon.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
function addonsPage() {
  const installedCount = state.addons.filter(addon => addon.status !== 'not-installed').length;
  const categories = addonCategories();
  const clientStatus = (state.client.addonsReady || state.client.installed) ? lt`${installedCount} installed · ${state.addons.filter(addon => addon.catalog !== false).length} catalog packages · ${state.addonFolderCount} addon folders` : lt`${state.addons.filter(addon => addon.catalog !== false).length || '—'} catalog packages · ${state.addonFolderCount || '—'} addon folders · select a client to install`;
  return lh`<div class="content-page addon-page">${titleBlock(t('Addons'), t('Browse addon folders and versions. Use Rescan to verify files against the catalog. Addons inside MPQ patches and in-game enabled status are not inspected. Your addons are never installed automatically.'), t('LOCAL CATALOG'))}<div class="tabs" role="tablist" aria-label="Addon categories"><button role="tab" aria-selected="${state.addonTab === 'browse'}" class="tab ${state.addonTab === 'browse' ? 'active' : ''}" data-addon-tab="browse">Browse addons</button><button role="tab" aria-selected="${state.addonTab === 'installed'}" class="tab ${state.addonTab === 'installed' ? 'active' : ''}" data-addon-tab="installed">Installed addons${installedCount ? lh` <span class="tab-count">${installedCount}</span>` : ''}</button></div><div class="addon-toolbar"><label class="search-box addon-search">${icon('search')}<input id="addon-search" aria-label="Search addons" placeholder="Search addons..." value="${escape(state.addonQuery)}"></label><label class="addon-category"><span>Category</span><select id="addon-category" aria-label="Addon category"><option value="all">All categories</option>${categories.map(category => lh`<option value="${escape(category)}" ${state.addonCategory === category ? 'selected' : ''}>${escape(category)}</option>`).join('')}</select></label><div class="addon-toolbar-actions"><button class="secondary-button" data-action="refresh-addons">${icon('refresh')}Rescan</button><button class="secondary-button" data-action="open-addons-folder" ${(state.client.addonsReady || state.client.installed) ? '' : 'disabled'}>${icon('folder')}AddOns folder</button>${!(state.client.addonsReady || state.client.installed) ? lh`<button class="gold-button" data-action="choose-client">${icon('folder')}Locate game</button>` : ''}</div></div><div class="addon-summary"><span class="status-dot"></span><span>${escape(clientStatus)}</span>${state.client.running ? launcherI18n.html('<strong>Close the game to change addons.</strong>') : ''}</div>${state.addonWarning ? lh`<p role="status">${escape(tm(state.addonWarning))}</p>` : ''}<div id="addon-results" class="addon-grid">${addonCardsHtml()}</div></div>`;
}
function renderAddonCatalog() {
  const target = document.getElementById('addon-results');
  if (!target) return;
  target.innerHTML = addonCardsHtml();
  fillIcons(target);
  const installedCount = state.addons.filter(addon => addon.status !== 'not-installed').length;
  const tab = document.querySelector('[data-addon-tab="installed"]');
  if (tab) tab.innerHTML = lt`Installed addons${installedCount ? lh` <span class="tab-count">${installedCount}</span>` : ''}`;
}
async function loadAddons(force = false, verify = false) {
  if (state.addonLoading) return;
  const clientPath = state.client.path || '';
  if (!force && (state.addonLoaded || state.addons.length || state.addonError) && state.addonClientPath === clientPath) { renderAddonCatalog(); return; }
  state.addonLoading = true; state.addonError = ''; renderAddonCatalog();
  try {
    const result = await api.addons(verify);
    if ((state.client.path || '') !== clientPath) return;
    state.addonClientPath = clientPath;
    state.addonWarning = (result.warnings || []).join(' ');
    state.addons = Array.isArray(result?.packages) ? result.packages : [];
    state.addonFolderCount = Number.isInteger(result?.folderCount) ? result.folderCount : 0;
  } catch (error) { if ((state.client.path || '') === clientPath) state.addonError = tm(error.message) || t('The addon catalog could not be loaded.'); }
  finally {
    if ((state.client.path || '') === clientPath) { state.addonClientPath = clientPath; state.addonLoaded = true; }
    state.addonLoading = false;
    if (state.page === 'addons') render();
  }
}
function showAddonDetails(packageId) {
  const addon = state.addons.find(item => item.id === packageId);
  if (!addon) return;
  const status = addonStatus(addon);
  const dependencyNames = addon.dependencies.map(id => state.addons.find(item => item.id === id)?.name || id);
  openModal(lh`${modalHeader(addon.name, t('CoA Custom Races addon catalog'))}<div class="modal-body addon-detail"><div class="addon-detail-head"><span class="addon-status ${status.className}">${escape(status.label)}</span><span>${escape(addon.category)}</span>${addon.version ? lh`<span>Catalog v${escape(addon.version)}</span>` : ''}${addon.installedVersion ? lh`<span>Installed v${escape(addon.installedVersion)}</span>` : ''}</div><p>${escape(addon.description)}</p>${addon.status !== 'not-installed' && !addon.managed ? launcherI18n.html('<p>Player-managed files. Scanning does not adopt, replace or remove these files.</p>') : ''}<h3>Addon folders</h3><div class="addon-folder-list">${addon.folders.map(folder => lh`<code>${escape(folder)}</code>`).join('')}</div>${dependencyNames.length ? lh`<h3>Catalog dependencies</h3><p>${dependencyNames.map(escape).join(', ')}</p>` : ''}${addon.externalDependencies.length ? lh`<div class="info-box">${icon('info')}<span>The addon metadata also references: ${addon.externalDependencies.map(escape).join(', ')}. These hard dependencies must already exist in your AddOns folder; installation is blocked if they are missing.</span></div>` : ''}</div><div class="modal-footer"><button class="secondary-button" data-action="dismiss-modal">Close</button>${addon.catalog !== false && (addon.status === 'not-installed' || addon.managed) && (state.client.addonsReady || state.client.installed) ? lh`<button class="gold-button" data-addon-install="${escape(addon.id)}" ${state.client.running || addon.managementBlocked ? 'disabled' : ''}>${icon(addon.status === 'not-installed' ? 'download' : 'refresh')}${addon.status === 'not-installed' ? t('Install') : t('Repair / reinstall')}</button>` : ''}</div>`, 'addon-dialog');
}
async function installAddon(packageId, button) {
  if (!(state.client.addonsReady || state.client.installed)) { await chooseClient(); return; }
  const addon = state.addons.find(item => item.id === packageId);
  if (!addon) throw new Error(t('Addon package was not found.'));
  const original = button?.innerHTML;
  if (button) { button.disabled = true; button.innerHTML = `${icon('refresh')}${t('Installing…')}`; fillIcons(button); }
  try {
    const response = await api.installAddon(packageId);
    if (response.result.cancelled) return;
    state.addons = response.catalog.packages;
    state.addonFolderCount = response.catalog.folderCount;
    if (modal.open && modal.classList.contains('addon-dialog')) closeModal();
    if (state.page === 'addons') render();
    toast(lt`${response.result.name} is installed and ready for your next login or UI reload.` + (response.result.preservedFiles ? ' ' + t('Modified files were backed up under .coa-launcher/preserved-addons.') : ''));
  } finally { if (button?.isConnected) { button.disabled = false; button.innerHTML = original; fillIcons(button); } }
}
function confirmAddonUninstall(packageId) {
  const addon = state.addons.find(item => item.id === packageId);
  if (!addon) return;
  openModal(lh`${modalHeader(lt`Uninstall ${addon.name}?`, t('Addon management'))}<div class="modal-body"><p>This removes unchanged launcher-installed files for <strong>${escape(addon.name)}</strong> from the selected client. Your modified files, manual additions and SavedVariables are kept.</p><div class="info-box">${icon('shield')}<span>Removal is blocked if another installed addon requires this package. Separate dependency packages are kept.</span></div></div><label class="setting-row"><input type="checkbox" id="remove-modified-addon-files"><span>${t('Also remove modified launcher-installed files. This cannot be undone. Manual additions and SavedVariables are kept.')}</span></label><div class="modal-footer"><button class="secondary-button" data-action="dismiss-modal">Cancel</button><button class="gold-button danger-button" data-addon-confirm-uninstall="${escape(addon.id)}">Uninstall addon</button></div>`);
}
async function uninstallAddon(packageId, button) {
  if (button) button.disabled = true;
  const response = await api.uninstallAddon(packageId, document.getElementById('remove-modified-addon-files')?.checked === true);
  state.addons = response.catalog.packages;
  state.addonFolderCount = response.catalog.folderCount;
  closeModal();
  if (state.page === 'addons') render();
  toast(lt`${response.result.name}: launcher-owned files removed. SavedVariables preserved.${response.result.preservedFiles ? lt` ${response.result.preservedFiles} modified file(s) kept.` : ''}`);
}
function render() {
  popoverRoot.innerHTML = '';
  if (!isEmbeddedPage()) api.databaseView({ visible: false }).catch(() => {});
  main.classList.toggle('database-mode', isEmbeddedPage());
  for (const button of document.querySelectorAll('.nav-link[data-page]')) { const active = button.dataset.page === state.page; button.classList.toggle('active', active); if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); }
  if (state.page === 'home') main.innerHTML = homePage();
  else if (state.page === 'news') main.innerHTML = newsPage();
  else if (state.page === 'updates') main.innerHTML = updatesPage();
  else if (state.page === 'races') main.innerHTML = racesPage();
  else if (state.page === 'bots') main.innerHTML = botsPage();
  else if (state.page === 'bugtracker') main.innerHTML = bugtrackerPage();
  else if (isEmbeddedPage()) main.innerHTML = databasePage();
  else if (state.page === 'addons') main.innerHTML = addonsPage();
  else if (state.page === 'builder') window.launcherBuilder.mount(main);
  else main.innerHTML = servicePage(state.page);
  document.getElementById('footer-client').textContent = state.client.running ? t('Game running') : (state.client.addonsReady || state.client.installed) ? t('Client ready') : t('No client selected');
  document.getElementById('version').textContent = `v${state.version}`;
  fillIcons();
  if (state.page === 'bugtracker') loadIssues();
  if (state.page === 'addons') loadAddons();
  if (state.page === 'updates' && !state.coaUpdates) loadUpdates();
  if (state.page === 'races') loadRaces();
  if (state.page === 'bots' && !state.coaBotRaces && state.settings.serverPath) loadBotRaces();
  if (isEmbeddedPage()) { updateDatabaseStatus(); requestAnimationFrame(syncDatabaseView); }
}
function showService(key) {
  if (key === 'discord') {
    const community = state.discord;
    const available = community?.available && community.guildId === state.config.discord?.guildId;
    const hasCounts = available && Number.isInteger(community.online) && Number.isInteger(community.members);
    const stats = hasCounts
      ? lh`<div class="community-stats"><div><strong><span class="community-online-dot" aria-hidden="true"></span>${escape(community.online.toLocaleString(launcherI18n.language))}</strong><span>${t('Online now')}</span></div><div><strong>${escape(community.members.toLocaleString(launcherI18n.language))}</strong><span>${t('Members')}</span></div></div>`
      : lh`<p class="community-counts-unavailable" role="status">${t('Community counts are currently unavailable.')}</p>`;
    openModal(lh`${modalHeader(t('Conquest on Discord'), t('Your adventure is better together'))}<div class="community-banner"><img src="assets/coa-custom-emblem.png" alt="" class="community-crest"><span class="community-banner-label">CoA Custom Races</span><span class="community-discord-badge">${icon('discord')}Discord</span></div><div class="modal-body community-body"><h2>${t('Join our community')}</h2><p>${t('Meet other players, find a guild, and share your adventures.')}</p>${stats}<div class="community-features"><div>${icon('user')}<span>${t('Find groups & guilds')}</span></div><div>${icon('info')}<span>${t('Get help')}</span></div><div>${icon('news')}<span>${t('Follow news & events')}</span></div></div></div><div class="modal-footer community-footer"><button class="ghost-button" data-action="dismiss-modal">${t('Back to launcher')}</button><button class="gold-button community-join" data-external="discord">${icon('discord')}${t('Join Discord')}${icon('external')}</button></div>`, 'community-dialog');
    return;
  }
  if (state.config.links[key]) { guarded(() => api.external(key)); return; }
  const service = services[key];
  openModal(lh`${modalHeader(t(service.title))}<div class="modal-body"><div class="empty-panel"><span class="empty-emblem">${icon(service.icon)}</span><h2>${t(service.heading)}</h2><p>${t(service.body)}</p><span class="page-tag">NOT CONNECTED YET</span></div></div><div class="modal-footer"><button class="secondary-button" data-action="dismiss-modal">Back to launcher</button></div>`);
}
function showArticle(id) {
  const article = articles.find(item => item.id === id); if (!article) return;
  openModal(lh`${modalHeader(t(article.title), 'CoA Custom Races')}<img class="article-image" src="assets/${article.image}" alt=""><div class="modal-body article-body"><div class="article-kicker">${t(article.category)}</div>${article.body.map(paragraph => lh`<p>${t(paragraph)}</p>`).join('')}</div>`, 'article-dialog');
}
function showInstall() {
  openModal(lh`${modalHeader(t('Begin your adventure'), 'CoA Custom Races')}<div class="modal-body"><div class="install-art"></div><label class="form-label">Game location</label><div class="path-field">${icon('folder')}<span>${escape(state.client.path || t('Choose your existing WoW client folder'))}</span><button class="secondary-button" data-action="choose-client">Browse</button></div><p>Select an existing client to enable the Play button.</p><div class="info-box">${icon('info')}<span>Choose the folder containing Ascension.exe.</span></div></div><div class="modal-footer"><button class="ghost-button" data-action="dismiss-modal">Cancel</button><button class="gold-button" data-action="choose-client">${icon('folder')}Locate existing client</button></div>`);
}
function accountDate(value, fallback = t('Never')) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString(launcherI18n.language);
}
function accountPlayTime(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return t('No recorded play time');
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours >= 24) return lt`${Math.floor(hours / 24)}d ${hours % 24}h played`;
  if (hours) return lt`${hours}h ${minutes}m played`;
  return lt`${minutes}m played`;
}
function showAccountLogin(prefill = '', notice = '') {
  state.account = null; state.accountOverview = null; state.accountCharacters = []; state.discordLink = null;
  openModal(lh`${modalHeader(t('Welcome, adventurer'), t('Sign in with your game account'))}<form id="launcher-login"><div class="modal-body">${notice ? lh`<div class="info-box" role="status">${icon('check')}<span>${escape(notice)}</span></div>` : ''}<label class="form-label" for="account-login">Account name or email</label><input class="account-input" id="account-login" autocomplete="username" maxlength="254" value="${escape(prefill)}" required><label class="form-label" for="account-password">Password</label><input class="account-input" id="account-password" type="password" autocomplete="current-password" maxlength="128" required><div id="login-two-factor" hidden><label class="form-label" for="account-code">Authenticator or recovery code</label><input class="account-input" id="account-code" autocomplete="one-time-code" maxlength="256" spellcheck="false"><p>Enter the code from your authenticator app or a recovery code.</p></div><label class="setting-row"><input type="checkbox" id="remember-account" checked><span>Remember me on this PC</span></label><p class="credits">With automatic game login enabled, Remember me also saves your game credentials using system encryption.</p><p id="login-error" role="alert"></p><div class="account-actions"><button type="submit" class="gold-button">Sign in</button><button type="button" class="secondary-button" data-action="register">Create account</button><button type="button" class="ghost-button" data-external="account">Account help</button></div><p class="credits">Remembered sign-in is protected by system encryption. Sign out to remove saved credentials.</p></div></form>`);
  document.getElementById(prefill ? 'account-password' : 'account-login').focus();
}
function showRegister() {
  openModal(lh`${modalHeader(t('Create account'), t('Your next chapter starts here'))}<div class="modal-body register-body"><aside class="register-art"><img src="assets/coa-custom-emblem.png" alt="" class="register-crest"><div class="register-art-copy"><span class="account-kicker">CONQUEST OF AZEROTHCORE</span><h3>A world<br>worth returning to</h3><span class="register-art-rule"></span><p>Begin your adventure.<br>Make Azeroth your own.</p></div><span class="register-realm-tag">LIVE / PUBLIC</span></aside><section class="register-form-panel" aria-label="Account details"><div class="register-intro"><span class="account-kicker">YOUR ADVENTURE BEGINS HERE</span><h3>Join the Conquest</h3><p>One account for the launcher and the game.</p></div><div id="register-error" class="info-box register-error" role="alert" aria-live="assertive" style="display:none"></div><div class="report-grid"><label class="report-field"><span>Account name</span><input id="register-username" type="text" maxlength="64" autocomplete="username" placeholder="Choose an account name"></label><label class="report-field"><span>Email address</span><input id="register-email" type="email" maxlength="254" autocomplete="email" placeholder="you@example.com"></label><label class="report-field"><span>Password</span><input id="register-password" type="password" maxlength="128" autocomplete="new-password" placeholder="Create a password"></label><label class="report-field"><span>Confirm password</span><input id="register-confirm" type="password" maxlength="128" autocomplete="new-password" placeholder="Repeat your password"></label></div><label class="register-consent"><input id="register-test-warning" type="checkbox"><span><strong>Ready to explore Azeroth</strong><span>I understand this account is for the CoA Custom Races live and PTR realms.</span></span></label><div class="register-account-note">${icon('shield')}<span>Use these same details to sign in to the launcher and enter Azeroth.</span></div></section></div><div class="modal-footer"><span class="register-footer-note">Already an adventurer?</span><button class="secondary-button" data-action="account-back">Back to sign in</button><button class="gold-button" data-action="account-register">${icon('user')}Create account</button></div>`, 'register-dialog');
  requestAnimationFrame(() => document.getElementById('register-username')?.focus());
}
function showRegistrationError(message) {
  const box = document.getElementById('register-error');
  if (!box) { toast(message || t('Account creation failed.')); return; }
  box.innerHTML = lh`${icon('info')}<span>${escape(tm(message) || t('Account creation failed.'))}</span>`;
  box.style.display = 'flex';
  fillIcons(box);
  box.scrollIntoView({ block: 'nearest' });
}
function clearRegistrationError() {
  const box = document.getElementById('register-error');
  if (!box) return;
  box.style.display = 'none';
  box.innerHTML = '';
}
async function submitAccountLogin(button) {
  const login = document.getElementById('account-login')?.value.trim() || '';
  const password = document.getElementById('account-password')?.value || '';
  if (!login || !password) { toast(t('Enter your account name/email and password.')); return; }
  if (button) button.disabled = true;
  try {
    const codeInput = document.getElementById('account-code');
    const codeRequired = document.getElementById('login-two-factor')?.hidden === false;
    const result = await api.login(login, password, codeRequired ? codeInput.value : undefined, document.getElementById('remember-account')?.checked !== false);
    if (result?.twoFactorRequired === true) {
      const section = document.getElementById('login-two-factor');
      section.hidden = false;
      codeInput.required = true;
      codeInput.value = '';
      document.getElementById('login-error').textContent = tm(result.message);
      codeInput.focus();
      return;
    }
    const enteringLauncher = typeof syncAuthGate === 'function' && !state.account;
    state.account = result;
    if (typeof syncAuthGate === 'function') syncAuthGate(result);
    document.getElementById('account-password').value = '';
    if (codeInput) codeInput.value = '';
    document.getElementById('account-password')?.setAttribute('value', '');
    if (enteringLauncher) { closeModal(); state.page = 'home'; render(); }
    else await loadAccountDashboard();
    toast(state.account?.persistenceWarning || lt`Welcome back, ${state.account?.username || login}.`);
  } catch (error) {
    const passwordInput = document.getElementById('account-password');
    if (passwordInput) passwordInput.value = '';
    const codeInput = document.getElementById('account-code');
    if (codeInput) codeInput.value = '';
    const box = document.getElementById('login-error');
    if (box) box.textContent = tm(error.message);
  } finally {
    const passwordInput = document.getElementById('account-password');
    if (passwordInput && document.getElementById('login-two-factor')?.hidden !== false) passwordInput.value = '';
    if (button?.isConnected) button.disabled = false;
  }
}
async function submitAccountRegistration(button) {
  const username = document.getElementById('register-username')?.value.trim() || '';
  const email = document.getElementById('register-email')?.value.trim() || '';
  const password = document.getElementById('register-password')?.value || '';
  const confirmPassword = document.getElementById('register-confirm')?.value || '';
  const acceptTestWarning = document.getElementById('register-test-warning')?.checked === true;

  clearRegistrationError();

  if (!username || !email || !password || !confirmPassword) {
    showRegistrationError(t('Complete all account fields first.'));
    return;
  }
  if (password !== confirmPassword) {
    showRegistrationError(t('The passwords do not match.'));
    return;
  }
  if (!acceptTestWarning) {
    showRegistrationError(t('Confirm that you understand this account is for the live and PTR realms.'));
    return;
  }

  if (button) button.disabled = true;

  try {
    const result = await api.register(username, email, password, confirmPassword, acceptTestWarning);
    const passwordInput = document.getElementById('register-password');
    const confirmInput = document.getElementById('register-confirm');
    if (passwordInput) passwordInput.value = '';
    if (confirmInput) confirmInput.value = '';
    showAccountLogin(username, result?.message || t('Account created. You can now sign in.'));
  } catch (error) {
    showRegistrationError(tm(error?.message) || t('Account creation failed.'));
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
}
function accountCharactersHtml() {
  if (!state.accountCharacters.length) return launcherI18n.html('<div class="account-empty"><img src="assets/coa-custom-emblem.png" alt=""><h3>Your story begins here</h3><p>Create your first character in game, then refresh to see them here.</p></div>');
  return state.accountCharacters.map(character => {
    const name = character?.name || t('Unknown character');
    const level = Number.isFinite(Number(character?.level)) ? Number(character.level) : 0;
    const online = character?.online === true || Number(character?.online) === 1;
    return lh`<article class="account-character"><div class="character-level"><strong>${level}</strong><span>LEVEL</span></div><div class="character-identity"><h4>${escape(name)}</h4><p>${escape(accountPlayTime(character?.totalTime))}</p></div><span class="character-presence ${online ? 'is-online' : ''}"><i></i>${online ? t('Online') : t('Offline')}</span></article>`;
  }).join('');
}
function discordAccountHtml() {
  const link = state.discordLink;
  if (!link || link.available === false) {
    const message = link?.message || t('Discord account linking is currently unavailable.');
    return lh`<div class="setting-row"><span><span class="setting-title">Discord</span><span class="setting-description">${escape(tm(message))}</span></span><span class="inline-badge">UNAVAILABLE</span></div>`;
  }
  if (link.linked) {
    const display = link.globalName || link.username || t('Discord account');
    const handle = link.username ? `@${link.username}` : lt`ID ${link.userId}`;
    return lh`<div class="setting-row discord-linked"><span><span class="setting-title">${icon('discord')}${escape(display)}</span><span class="setting-description">${escape(handle)} · Linked ${escape(accountDate(link.linkedAt, t('Unknown')))}</span></span><span class="inline-badge">CONNECTED</span></div><div class="button-row"><button class="secondary-button" data-action="discord-account-unlink">Disconnect Discord</button></div>`;
  }
  return lh`<div class="setting-row"><span><span class="setting-title">${icon('discord')}Discord</span><span class="setting-description">Keep your community close. Connect your Discord account.</span></span><span class="inline-badge">NOT CONNECTED</span></div><div class="button-row"><button class="gold-button" data-action="discord-account-link">Connect Discord</button></div>`;
}
async function linkDiscordAccount(button) {
  const account = state.account;
  if (button?.isConnected) button.disabled = true;
  try {
    await api.discordLink();
    toast(t('Discord opened in your browser. Approve the connection there.'));
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      if (state.account !== account || !button?.isConnected || !modal.open) return;
      const link = await api.discordLinkStatus();
      if (state.account !== account || !button?.isConnected || !modal.open) return;
      state.discordLink = link;
      if (link?.linked) {
        renderAccountDashboard();
        toast(t('Discord account connected.'));
        return;
      }
    }
    renderAccountDashboard();
    toast(t('Discord connection is still pending. Approve it in your browser, then use Refresh.'));
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
}
function confirmDiscordUnlink() {
  const link = state.discordLink || {};
  const display = link.globalName || link.username || t('this Discord account');
  openModal(lh`${modalHeader(t('Disconnect Discord'), t('Account connection'))}<div class="modal-body"><p>Disconnect <strong>${escape(display)}</strong> from this Conquest account?</p><p>The active link will be removed, but the launcher backend will keep an audit-log entry recording that the account was unlinked.</p></div><div class="modal-footer"><button class="secondary-button" data-action="account-refresh">Cancel</button><button class="gold-button" data-action="discord-account-unlink-confirm">Disconnect Discord</button></div>`);
}
async function unlinkDiscordAccount(button) {
  if (button?.isConnected) button.disabled = true;
  try {
    await api.discordUnlink();
    await loadAccountDashboard();
    toast(t('Discord account disconnected.'));
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
}
function renderAccountDashboard() {
  const overview = state.accountOverview || {};
  const username = overview.username || state.account?.username || t('Account');
  const joined = accountDate(overview.joinDate, t('Unknown'));
  const lastLogin = accountDate(overview.lastLogin);
  const count = state.accountCharacters.length;
  const totalTime = state.accountCharacters.reduce((sum, character) => sum + Math.max(0, Number(character?.totalTime) || 0), 0);
  openModal(lh`${modalHeader(t('My account'), 'CoA Custom Races')}<div class="modal-body account-dashboard-body"><section class="account-hero"><img class="account-hero-crest" src="assets/coa-custom-emblem.png" alt=""><div class="account-hero-copy"><span class="account-kicker">WELCOME BACK, ADVENTURER</span><h3>${escape(username)}</h3><p>${escape(overview.email || t('Your next adventure awaits in Azeroth.'))}</p></div><span class="account-session"><i></i>Signed in</span></section><div class="account-dashboard-grid"><section class="account-roster"><div class="account-section-heading"><h3>Your characters</h3><span>Characters: ${count}</span></div><div class="account-roster-list">${accountCharactersHtml()}</div><div class="account-playtime"><span>Time in Azeroth</span><strong>${escape(accountPlayTime(totalTime))}</strong></div></section><aside class="account-sidebar"><section class="account-details-card"><div class="account-section-heading"><h3>Account details</h3></div><dl><div><dt>Member since</dt><dd>${escape(joined)}</dd></div><div><dt>Last game login</dt><dd>${escape(lastLogin)}</dd></div></dl></section><section class="account-discord-card"><div class="account-section-heading"><h3>${icon('discord')}Stay connected</h3></div>${discordAccountHtml()}</section></aside></div></div><div class="modal-footer"><span class="account-footer-note">${icon('shield')}Your Azeroth. Your account.</span><button class="secondary-button" data-action="account-refresh">${icon('refresh')}Refresh</button><button class="secondary-button" data-action="account-logout">${icon('logout')}Sign out</button><button class="gold-button" data-action="dismiss-modal">Done</button></div>`, 'account-dashboard-dialog');
}
async function loadAccountDashboard() {
  const [overview, characters, discordLink] = await Promise.all([
    api.accountOverview(),
    api.accountCharacters(),
    api.discordLinkStatus().catch(error => ({ available: false, linked: false, message: tm(error?.message) || t('Discord account linking is unavailable.') }))
  ]);
  state.accountOverview = overview || null;
  state.accountCharacters = Array.isArray(characters) ? characters : [];
  state.discordLink = discordLink || null;
  renderAccountDashboard();
}
async function showAccount() {
  openModal(lh`${modalHeader(t('My account'), 'CoA Custom Races')}<div class="modal-body"><div class="empty-panel">${icon('refresh')}<h2>Checking your account…</h2><p>Connecting to the launcher account service.</p></div></div>`);
  const account = await api.account();
  state.account = account;
  if (!account) { showAccountLogin(); return; }
  await loadAccountDashboard();
}
async function logoutAccount() {
  await api.logout();
  state.account = null; state.accountOverview = null; state.accountCharacters = []; state.discordLink = null;
  if (typeof syncAuthGate === 'function') syncAuthGate(null);
  showAccountLogin('', t('You have been signed out.'));
}
function showTrailer() {
  openModal(lh`
    ${modalHeader(t('A world of adventure'), 'CoA Custom Races')}

    <div class="modal-body">
      <div class="youtube-trailer">
		<iframe
		  src="https://www.youtube-nocookie.com/embed/JbP2Jy3VdEk?rel=0"
		  title="CoA Custom Races Trailer"
		  referrerpolicy="strict-origin-when-cross-origin"
		  allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
		  allowfullscreen>
		</iframe>
      </div>
    </div>

    <div class="modal-footer">
      <button class="gold-button" data-action="dismiss-modal">
        Return to Azeroth
      </button>
    </div>
  `, 'article-dialog');
}
function toggleRow(key, title, description) { return lh`<label class="setting-row"><span><span class="setting-title">${title}</span><span class="setting-description">${description}</span></span><input class="switch" type="checkbox" data-setting="${key}" ${state.settings[key] ? 'checked' : ''} aria-label="${title}"></label>`; }
function showSettings(tab = state.settingsTab) {
  state.settingsTab = tab;
  let body;
  if (tab === 'launcher') body = lh`<h3>Launcher settings</h3><p>Make yourself at home.</p><label class="setting-row"><span class="setting-title">Language</span><select data-setting="language" aria-label="Language">${languageOptions()}</select></label><label class="setting-row"><span class="setting-title">Start page</span><select data-setting="startPage" aria-label="Start page"><option value="home" ${state.settings.startPage === 'home' ? 'selected' : ''}>Home</option><option value="news" ${state.settings.startPage === 'news' ? 'selected' : ''}>News</option></select></label>${toggleRow('reducedMotion', t('Reduce motion'), t('Turn off interface animations and transitions.'))}<p class="credits">Settings are saved automatically on this computer.</p>`;
  else if (tab === 'game') body = lh`<h3>CoA Custom Races</h3><p>Game installation and maintenance.</p><label class="form-label">Client folder</label><div class="path-field">${icon('folder')}<span>${escape(state.client.path || t('No client selected'))}</span></div><div class="button-row"><button class="gold-button" data-action="choose-client">Browse</button><button class="secondary-button" data-action="open-folder" ${state.client.installed ? '' : 'disabled'}>Open folder</button></div><div class="setting-row"><span><span class="setting-title">Client status</span><span class="setting-description">${state.client.installed ? t('Game executable found.') : t('Select the folder containing Ascension.exe.')}</span></span><span class="inline-badge">${state.client.installed ? t('READY') : t('NOT SET')}</span></div><div class="button-row"><button class="secondary-button" data-action="repair">${icon('shield')}Scan & repair</button><button class="secondary-button" data-action="check-updates">${icon('refresh')}Check for updates</button></div><p class="credits">Repair and updates require your client release service.</p>`;
  else if (tab === 'downloads') body = lh`<h3>Downloads</h3><p>Manage the bandwidth used by client downloads and repairs.</p><label class="setting-row"><span><span class="setting-title">Download speed limit (MB/s)</span><span class="setting-description">0 = Unlimited. Changes apply to the current download.</span></span><input class="download-speed-input" type="number" data-setting="downloadLimitMBps" aria-label="Download speed limit (MB/s)" min="0" max="10000" step="0.1" value="${state.settings.downloadLimitMBps || 0}"></label><p class="credits">Limits client downloads and repairs. Launcher updates are not limited.</p>`;
  else body = lh`<h3>CoA Custom Races</h3><p>Launcher version ${escape(state.version)}</p><div class="setting-row"><span class="setting-title">Platform</span><span class="setting-description">${window.launcher ? t('Windows desktop') : t('Browser')}</span></div>`;
  if (tab === 'about') body += launcherCreditsHtml();
  openModal(lh`${modalHeader(t('Settings'), 'CoA Custom Races')}<div class="settings-grid"><aside class="settings-sidebar"><button data-settings-tab="launcher" class="${tab === 'launcher' ? 'active' : ''}">${icon('monitor')}Launcher</button><button data-settings-tab="game" class="${tab === 'game' ? 'active' : ''}">${icon('play')}Game client</button><button data-settings-tab="downloads" class="${tab === 'downloads' ? 'active' : ''}">${icon('download')}Downloads</button><button data-settings-tab="about" class="${tab === 'about' ? 'active' : ''}">${icon('info')}About</button><small>v${escape(state.version)}</small></aside><div class="settings-pane">${body}</div></div><div class="modal-footer"><button class="gold-button" data-action="dismiss-modal">Done</button></div>`, 'settings-dialog');
}
function showPopover(button, kind) {
  if (popoverRoot.dataset.open === kind && popoverRoot.childElementCount) { popoverRoot.innerHTML = ''; return; }
  let content = '';
  if (kind === 'play-options') content = lh`<div class="popover-label">GAME OPTIONS</div><button data-action="choose-client">${icon('folder')}Locate game</button><button data-action="open-folder">${icon('external')}Open game folder</button><hr><button data-action="check-updates">${icon('refresh')}Check for updates</button><button data-action="repair">${icon('shield')}Scan & repair</button><hr><button data-action="game-settings">${icon('settings')}Game settings</button>`;
  else if (kind === 'realms') content = lh`<div class="popover-label">YOUR GAMES</div><button class="selected" data-action="select-realm"><span class="realm-icon realm-icon-image"><img src="assets/coa-custom-emblem.png" alt=""></span>CoA Custom Races${icon('check')}</button><div class="popover-note">Your project’s client and realm.</div>`;
  else if (kind === 'notifications') content = window.launcherNotifications?.html?.() || lh`<div class="popover-heading">${t('Notifications')}</div><hr><div class="popover-note">${t('No new notifications.')}</div>`;
  else content = '';
  const className = kind === 'notifications' ? 'popover notification-popover' : 'popover';
  popoverRoot.dataset.open = kind; popoverRoot.innerHTML = lh`<div class="${className}">${content}</div>`;
  const panel = popoverRoot.firstElementChild;
  // CSSOM placement is local trusted UI state, with no remote styles.
  const rect = button.getBoundingClientRect();
  panel.style.top = `${Math.min(rect.bottom + 8, innerHeight - panel.offsetHeight - 20)}px`;
  panel.style.left = `${Math.max(15, Math.min(rect.right - panel.offsetWidth, innerWidth - panel.offsetWidth - 15))}px`;
  fillIcons(panel);
}
function pendingUpdate(repair = false) {
  openModal(lh`${modalHeader(repair ? t('Scan & repair') : t('Client updates'))}<div class="modal-body"><p>${repair ? t('The launcher needs your published client manifest to check files and repair missing or damaged data.') : t('Your client release service has not been connected yet. Downloads and updates will be added after the design review.')}</p><div class="info-box">${icon('info')}<span>No game files have been changed.</span></div></div><div class="modal-footer"><button class="gold-button" data-action="dismiss-modal">Got it</button></div>`);
}
async function chooseClient() {
  const client = await api.chooseClient();
  if (!client) return;
  state.client = client; state.settings.installPath = client.path;
  state.addons = []; state.addonFolderCount = 0; state.addonClientPath = null; state.addonWarning = '';
  if (modal.open && modal.classList.contains('settings-dialog')) showSettings('game'); else closeModal();
  render(); if (state.page === 'addons') loadAddons(true);
  if (!client.installed) showInstall(); else toast(t('Client selected. Files will be checked before playing.'));
}
const actions = {
  minimize: () => api.window('minimize'), maximize: () => api.window('maximize'), close: () => api.window('close'),
  settings: () => showSettings('launcher'), 'game-settings': () => showSettings('game'),
  'dismiss-modal': closeModal,
  'view-license': showLegalNotices,
  'choose-client': chooseClient,
  'open-folder': () => api.openFolder(),
  'check-updates': () => pendingUpdate(false), repair: () => pendingUpdate(true),
  play: async () => {
    if (state.client.running) { toast(t('Your game is already running.')); return; }
    if (!state.client.installed) { showInstall(); return; }
    await api.launch(); state.client.running = true; render();
  },
  'play-options': element => showPopover(element, 'play-options'),
  realms: element => showPopover(element, 'realms'),
  notifications: element => showPopover(element, 'notifications'),
  'select-realm': () => { popoverRoot.innerHTML = ''; state.page = 'home'; render(); },
  account: showAccount,
  register: showRegister,
  'account-back': () => showAccountLogin(),
  'account-login': button => submitAccountLogin(button),
  'account-register': button => submitAccountRegistration(button),
  'account-refresh': () => loadAccountDashboard(),
  'account-logout': logoutAccount,
  'discord-account-link': button => linkDiscordAccount(button),
  'discord-account-unlink': confirmDiscordUnlink,
  'discord-account-unlink-confirm': button => unlinkDiscordAccount(button),
  wiki: () => showService('wiki'), discord: () => showService('discord'), support: () => showService('support'),
  welcome: () => showArticle('welcome'), trailer: showTrailer,
  'database-reload': async () => {
    embeddedStatuses.set(state.page, { state: 'loading', message: '' }); updateDatabaseStatus();
    await api.reloadDatabase(state.page);
    requestAnimationFrame(syncDatabaseView);
  },
  'refresh-issues': () => loadIssues(true),
  'refresh-addons': () => loadAddons(true, true),
  'open-addons-folder': () => api.openAddonsFolder(),
  'report-bug': showBugReport,
  'submit-bug': submitBugForm,
  'open-issue': element => api.openIssue(Number(element.dataset.issueOpen)),
  'coa-coffee': () => api.coaOpen('coffee'),
  'coa-backups': () => showBackups(),
  'coa-accounts': () => showAccounts(),
  'coa-account-create': async button => {
    const notice = document.getElementById('acc-notice'); button.disabled = true; notice.textContent = t('Creating the account…');
    try {
      const made = await api.coaCreateAccount({ username: document.getElementById('acc-name').value, password: document.getElementById('acc-pass').value, gm: document.getElementById('acc-gm').checked });
      await showAccounts(lt`Account ${made.username} created. Log in with it in the game.`);
    } catch (error) { notice.textContent = tm(error.message); button.disabled = false; }
  },
  'coa-delete-server-ask': () => openModal(lh`${modalHeader(t('Delete your server?'), state.settings.serverPath)}<div class="modal-body"><p>${t('This stops the server and permanently deletes its whole folder, including every character, account and the launcher backups stored inside it. This cannot be undone.')}</p><p>${t('To keep your characters, copy the Backups folder somewhere else first.')}</p></div><div class="modal-footer"><button class="secondary-button" data-action="dismiss-modal">${t('Cancel')}</button><button class="secondary-button" data-action="coa-backup-folder">${t('Open backups folder')}</button><button class="gold-button danger-button" data-action="coa-delete-server-go">${t('Delete server')}</button></div>`, 'backup-dialog'),
  'coa-delete-server-go': async () => {
    closeModal();
    await coaRun(t('Deleting the server…'), async () => { await api.coaDeleteServer(); state.settings.serverPath = ''; state.coaStatus = t('Server deleted.'); state.coaUpdates = null; render(); });
  },
  'coa-delete-client-ask': () => openModal(lh`${modalHeader(t('Delete the game client?'), '')}<div class="modal-body"><p>${t('This permanently deletes the whole game folder the launcher uses, including its settings, screenshots and addons. You can download the client again later. This cannot be undone.')}</p></div><div class="modal-footer"><button class="secondary-button" data-action="dismiss-modal">${t('Cancel')}</button><button class="gold-button danger-button" data-action="coa-delete-client-go">${t('Delete game client')}</button></div>`, 'backup-dialog'),
  'coa-delete-client-go': async () => {
    closeModal();
    await coaRun(t('Deleting the game client…'), async () => { await api.coaDeleteClient(); state.coaStatus = t('Game client deleted.'); state.coaUpdates = null; state.client = await api.clientInfo(); state.settings = await api.bootstrap().then(data => data.settings); render(); });
  },
  'coa-trouble': showTroubleshoot,
  'coa-backup-folder': () => api.coaOpenBackups(),
  'coa-backup-now': async button => {
    button.disabled = true; document.getElementById('backup-notice').textContent = t('Backing up… do not close the launcher.');
    try { const made = await api.coaBackup(); await showBackups(lt`Saved ${made.name} (${formatSize(made.size)}).`); }
    catch (error) { document.getElementById('backup-notice').textContent = tm(error.message); button.disabled = false; }
  },
  'coa-restore-ask': element => {
    const name = element.dataset.name;
    openModal(lh`${modalHeader(t('Restore this backup?'), name)}<div class="modal-body"><p>${t('Every character and account will be replaced by this backup. Anything created since then is lost, but your current state is saved first so you can undo this.')}</p></div><div class="modal-footer"><button class="secondary-button" data-action="coa-backups">${t('Cancel')}</button><button class="gold-button" data-action="coa-restore-go" data-name="${escape(name)}">${t('Restore')}</button></div>`, 'backup-dialog');
  },
  'coa-restore-go': async button => {
    const name = button.dataset.name; button.disabled = true;
    try { const done = await api.coaRestore(name); closeModal(); state.coaStatus = lt`Restored ${done.restored}. Previous state saved as ${done.safety}.`; render(); toast(t('Backup restored. Start the server.')); }
    catch (error) { closeModal(); toast(tm(error.message)); }
  },
  'coa-refresh-updates': () => { state.coaUpdates = null; render(); },
  'coa-check-client': () => actions['check-updates'](),
  'coa-update': element => coaRun(lt`Updating ${moduleNames[element.dataset.key]}…`, async () => {
    const key = element.dataset.key;
    const result = key === 'server' ? await api.coaUpdateServer() : await api.coaUpdateModule(key);
    state.coaStatus = key === 'server' ? (result.upToDate ? t('Server is up to date.') : lt`Server updated to ${result.version}, ${result.applied} database updates applied.`) : lt`${moduleNames[key]} updated.`;
    state.coaUpdates = null; state.settings = await api.bootstrap().then(data => data.settings); render();
  }),
  'coa-bots-all': () => { for (const box of main.querySelectorAll('[data-bot-race]:not(:disabled)')) box.checked = true; },
  'coa-bots-none': () => { for (const box of main.querySelectorAll('[data-bot-race]:not(:disabled)')) box.checked = false; },
  'coa-bots-save': async () => {
    const allowed = [...main.querySelectorAll('[data-bot-race]:checked')].flatMap(box => box.dataset.botRace.split(',').map(Number));
    const result = await api.coaSetBotRaces(allowed);
    state.coaBotRaces = { ...state.coaBotRaces, excluded: result.excluded };
    toast(lt`Saved: bots spawn as ${allowed.length} race ids. Restart the server to apply.`);
  },
  'coa-duff': () => api.coaOpen('duff'),
  'coa-link': element => api.coaOpen(element.dataset.link),
  'coa-modules': showModules,
  'coa-realm': showRealm,
  'coa-create': () => coaRun(t('Creating your server…'), async () => {
    const created = await api.coaCreateServer();
    if (!created) { state.coaStatus = ''; render(); return; }
    state.settings.serverPath = created.path; state.settings.localMode = true;
    state.coaStatus = lt`Server ${created.version} is ready. Press Start.`; render();
  }),
  'coa-locate': async () => { const found = await api.coaLocateServer(); if (found) { state.settings.serverPath = found.path; state.settings.localMode = true; render(); toast(t('Server folder selected.')); } },
  'coa-start': () => coaRun(t('Starting the server…'), async () => { await api.coaStartServer(); state.coaStatus = t('Server is running.'); render(); }),
  'coa-stop': () => coaRun(t('Stopping the server…'), async () => { await api.coaStopServer(); state.coaStatus = t('Server stopped.'); render(); }),
  'coa-apply': async () => {
    const choice = {};
    for (const box of modalContent.querySelectorAll('[data-module]')) choice[box.dataset.module] = box.checked;
    closeModal();
    await coaRun(t('Applying modules…'), async () => {
      const result = await api.coaApplyModules(choice);
      state.settings.modules = choice;
      state.coaStatus = [t('Modules applied.'), ...(result?.notes || [])].join(' '); render();
    });
  },
  'coa-realm-save': async () => {
    const picked = modalContent.querySelector('input[name="realm-mode"]:checked');
    if (!picked) { toast(t('Choose how players connect.')); return; }
    const address = picked.value === 'local' ? '127.0.0.1' : modalContent.querySelector('#realm-address').value;
    const result = await api.coaSetRealm(picked.value, address);
    Object.assign(state.settings, { realmMode: picked.value, realmlist: result.realmlist, localMode: true });
    closeModal(); render();
    toast(lt`Realmlist set to ${result.realmlist}. Server: ${result.server}.`);
  }
};
main.addEventListener('input', event => {
  if (event.target.id !== 'race-search') return;
  state.raceQuery = event.target.value;
  const results = document.getElementById('race-results');
  if (results) results.outerHTML = new DOMParser().parseFromString(racesPage(), 'text/html').getElementById('race-results').outerHTML;
});
// Picking a realm mode fills the address box with the detected IP.
modalContent.addEventListener('change', event => {
  if (event.target.name === 'realm-mode' && event.target.dataset.address) document.getElementById('realm-address').value = event.target.dataset.address;
});
api.onCoaProgress?.(status => {
  if (!status) return;
  const pct = status.total ? ` ${Math.floor(status.done / status.total * 100)}% (${(status.done / 2 ** 30).toFixed(2)} / ${(status.total / 2 ** 30).toFixed(2)} GB)` : '';
  state.coaStatus = `${status.message || ''}${pct}`;
  const line = document.getElementById('coa-status');
  if (line) line.textContent = state.coaStatus;
});
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!event.target.closest('.popover') && !button?.matches('[data-action="realms"],[data-action="notifications"],[data-action="play-options"]')) popoverRoot.innerHTML = '';
  if (!button || button.disabled) return;
  if (button.dataset.page) { state.page = button.dataset.page; render(); main.scrollTop = 0; }
  else if (button.dataset.addonInstall) guarded(() => installAddon(button.dataset.addonInstall, button));
  else if (button.dataset.addonUninstall) confirmAddonUninstall(button.dataset.addonUninstall);
  else if (button.dataset.addonConfirmUninstall) guarded(() => uninstallAddon(button.dataset.addonConfirmUninstall, button));
  else if (button.dataset.addonDetails) showAddonDetails(button.dataset.addonDetails);
  else if (button.dataset.issueNumber) showIssue(Number(button.dataset.issueNumber));
  else if (button.dataset.article) showArticle(button.dataset.article);
  else if (button.dataset.settingsTab) showSettings(button.dataset.settingsTab);
  else if (button.dataset.newsTab) { state.newsTab = button.dataset.newsTab; render(); }
  else if (button.dataset.addonTab) { state.addonTab = button.dataset.addonTab; render(); }
  else if (button.dataset.external) guarded(() => api.external(button.dataset.external));
  else if (actions[button.dataset.action]) guarded(() => actions[button.dataset.action](button));
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') popoverRoot.innerHTML = ''; });
document.addEventListener('input', event => {
  if (event.target.id === 'bug-search') { state.issueQuery = event.target.value; renderIssueResults(); }
  else if (event.target.id === 'addon-search') { state.addonQuery = event.target.value; renderAddonCatalog(); }
});
document.addEventListener('change', event => {
  const element = event.target;
  if (element.id === 'addon-category') { state.addonCategory = element.value; renderAddonCatalog(); return; }
  if (!element.dataset.setting) return;
  if (element.dataset.setting === 'downloadLimitMBps' && (!element.value.trim() || !element.checkValidity())) { element.reportValidity(); return; }
  guarded(async () => {
    element.disabled = true;
    try {

      const patch = { [element.dataset.setting]: element.type === 'checkbox' ? element.checked : element.dataset.setting === 'downloadLimitMBps' ? Number(element.value) : element.value };
      state.settings = await api.saveSettings(patch);
      if (element.dataset.setting === 'language') applyLanguage(state.settings.language);
      document.body.classList.toggle('motion-reduced', state.settings.reducedMotion);
      toast(t(element.dataset.setting === 'autoLoginGame' && element.checked ? 'Automatic game login enabled. Sign out and sign into the launcher again before pressing Play.' : 'Settings saved.'));
    } finally { element.disabled = false; }
  });
});
window.addEventListener('resize', () => { popoverRoot.innerHTML = ''; if (isEmbeddedPage()) requestAnimationFrame(syncDatabaseView); });
main.addEventListener('scroll', () => { if (isEmbeddedPage()) requestAnimationFrame(syncDatabaseView); });
api.onDatabaseStatus(status => {
  if (!status || typeof status !== 'object') return;
  const page = status.page || 'database';
  if (page !== 'database' && page !== 'armory') return;
  embeddedStatuses.set(page, { state: status.state === 'ready' || status.state === 'error' ? status.state : 'loading', message: typeof status.message === 'string' ? status.message : '' });
  if (page !== state.page) return;
  state.databaseStatus = status.state === 'ready' || status.state === 'error' ? status.state : 'loading';
  state.databaseMessage = typeof status.message === 'string' ? status.message : '';
  updateDatabaseStatus();
});
api.onGameExit(() => { state.client.running = false; render(); toast(t('Your game has closed.')); });
async function start() {
  fillIcons();
  let needsLanguageSelection = false;
  try {
    const data = await api.bootstrap(); Object.assign(state, data);
    if (state.settings.localMode) syncAuthGate(state.account); // saved local mode opens without an account
    launcherI18n.setLanguage(state.settings.language);
    state.page = state.settings.startPage || 'home';
    document.body.classList.toggle('motion-reduced', state.settings.reducedMotion);
    refreshLanguageShell();
    needsLanguageSelection = !state.settings.languageSelected;
  } catch (error) { toast(lt`Could not load launcher settings: ${tm(error.message)}`); }
  render();
  if (needsLanguageSelection) {
    modal.addEventListener('close', () => { if (state.settings.languageSelected) setTimeout(showAddonCleanupReminder, 0); }, { once: true });
    showFirstLanguage();
  } else showAddonCleanupReminder();
}
const addonCleanupNoticeKey = 'coa.addon-catalog-cleanup.0.7.2';
async function showAddonCleanupReminder() {
  if (modal.open || state.settings.addonCleanupDismissed === true) return;
  try { if (localStorage.getItem(addonCleanupNoticeKey)) return; } catch (_) {}
  const clientPath = state.client.path;
  if (!clientPath) return;
  let inventory;
  try { inventory = await api.addons(false); } catch (_) { return; }
  if (modal.open || state.settings.addonCleanupDismissed === true || state.client.path !== clientPath) return;
  if (!inventory?.packages?.some(addon => addon.catalog === false && addon.managed === true && addon.status !== 'not-installed')) return;
  openModal(lh`${modalHeader(t('Please remove old launcher addons'), t('Addon catalog update'))}<div class="modal-body"><p>${t('The old launcher addon catalog has been cleared because its outdated addons can override addons supplied by patch B.')}</p><div class="info-box">${icon('addons')}<span>${t('Open Addons and uninstall any addons you previously installed through the launcher catalog. If you never installed catalog addons, no action is needed.')}</span></div><p>${t('Nothing will be removed automatically. Modified files may need manual removal after uninstalling.')}</p><label class="setting-row"><input type="checkbox" id="dismiss-addon-cleanup-permanently" data-setting="addonCleanupDismissed"><span>${t('Do not remind me again')}</span></label></div><div class="modal-footer"><button class="secondary-button" data-action="dismiss-modal">${t('Later')}</button><button class="gold-button" data-action="review-old-addons">${icon('addons')}${t('Review installed addons')}</button></div>`, 'addon-cleanup-dialog');
}
actions['review-old-addons'] = () => {
  closeModal();
  state.page = 'addons';
  state.addonTab = 'installed';
  render();
};
window.addEventListener('DOMContentLoaded', start);
