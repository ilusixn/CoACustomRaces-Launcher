// Copyright (C) 2026 Duff (Duff-SPP). GPL-3.0-only; see LICENSE and ATTRIBUTION.md at the repository root.
'use strict';
const languageShell = new Map();
for (const selector of ['header', 'footer']) {
  const element = document.querySelector(selector);
  if (element) languageShell.set(element, element.innerHTML);
}
function languageOptions() {
  return launcherI18n.languages.map(item => `<option value="${item.code}" ${item.code === launcherI18n.language ? 'selected' : ''}>${item.name}</option>`).join('');
}
function refreshLanguageShell() {
  for (const [element, source] of languageShell) element.innerHTML = launcherI18n.html(source);
  fillIcons();
}
function applyLanguage(code) {
  launcherI18n.setLanguage(code);
  refreshLanguageShell();
  render();
  document.getElementById('connection-status').textContent = t('Local server mode');
  if (modal.open) {
    if (modal.classList.contains('language-dialog')) showLanguage();
    else if (modal.classList.contains('settings-dialog')) showSettings();
  }
}
function showLanguage() {
  openModal(lh`${modalHeader(t('Language'))}<div class="modal-body"><label class="setting-row"><span class="setting-title">Language</span><select data-setting="language" aria-label="Language">${languageOptions()}</select></label><p>Choose the language used by the launcher. This does not change the game language.</p></div><div class="modal-footer"><button class="gold-button" data-action="dismiss-modal">Done</button></div>`, 'language-dialog');
}
actions.language = showLanguage;
function showFirstLanguage() {
  openModal(lh`<div class="modal-header"><div><h2 id="modal-title">${t('Choose your language')}</h2></div></div><div class="modal-body"><p>${t('Select the language for your launcher. You can change it later using the globe button.')}</p><label class="form-label" for="first-language-choice">${t('Language')}</label><select id="first-language-choice" aria-label="${t('Language')}">${languageOptions()}</select></div><div class="modal-footer"><button class="gold-button" data-action="confirm-first-language">${icon('globe')}${t('Use language')}</button></div>`, 'first-language-dialog');
  document.getElementById('first-language-choice')?.focus();
}
actions['confirm-first-language'] = async button => {
  const select = document.getElementById('first-language-choice');
  if (!select || !launcherI18n.languages.some(language => language.code === select.value)) return;
  button.disabled = true;
  try {
    state.settings = await api.saveSettings({ language: select.value });
    closeModal();
    applyLanguage(state.settings.language);
  } finally { button.disabled = false; }
};
