// Copyright (C) 2026 Duff (Duff-SPP). GPL-3.0-only; see LICENSE and ATTRIBUTION.md at the repository root.
// The initial HTML stays locked until the existing website session is checked.
let authCheck = null;
function syncAuthGate(account, message = '') {
  if (!account && state.account) { closeModal(); state.accountOverview = null; state.accountCharacters = []; state.discordLink = null; }
  state.account = account || null;
  // CoA Custom Races: local mode (own server, LAN, Hamachi) needs no coa-development.org account.
  const locked = !account && !state.settings?.localMode;
  document.body.classList.toggle('auth-locked', locked);
  let gate = document.getElementById('auth-gate');
  if (!gate) {
    gate = document.createElement('section'); gate.id = 'auth-gate';
    document.body.append(gate);
  }
  gate.hidden = !locked;
  if (locked) gate.innerHTML = lh`<div class="auth-card"><img src="assets/coa-custom-logo.png" alt="CoA Custom Races"><p class="auth-eyebrow">${t('YOUR NEXT ADVENTURE AWAITS')}</p><h1>${t('Welcome to Azeroth')}</h1><p>${t('Sign in or create an account to enter the launcher.')}</p><p role="status">${escape(message)}</p><div class="account-actions"><button class="gold-button" data-auth="login">${t('Log in')}</button><button class="secondary-button" data-auth="register">${t('Create account')}</button><button class="secondary-button" data-auth="local">${t('Play on my own server (no account)')}</button></div><button class="ghost-button" data-auth="update">${t('Check for launcher updates')}</button><button class="ghost-button" data-auth="retry">${t('Check saved sign-in')}</button><small>v${escape(state.version)}</small></div>`;
  for (const element of document.querySelectorAll('.main-nav, .utilitybar, #main-content, footer')) element.inert = locked;
}
async function checkSavedSignIn() {
  if (authCheck) return authCheck;
  authCheck = (async () => {
    try { syncAuthGate(await api.account()); }
    catch { syncAuthGate(null, t('Account service unavailable. Please try again.')); }
    finally { authCheck = null; }
  })();
  return authCheck;
}
document.addEventListener('click', async event => {
  const action = event.target.closest('[data-auth]')?.dataset.auth;
  if (!action) return;
  try {
    if (action === 'login') showAccountLogin();
    if (action === 'register') showRegister();
    if (action === 'retry') await checkSavedSignIn();
    if (action === 'local') { state.settings = await api.saveSettings({ localMode: true }); syncAuthGate(null); render(); }
    if (action === 'update') { await api.checkLauncher(); showSettings('about'); }
  } catch (error) { toast(tm(error.message)); }
});
document.addEventListener('DOMContentLoaded', () => {
  syncAuthGate(null, t('Checking saved sign-in…'));
  checkSavedSignIn();
});
window.addEventListener('focus', checkSavedSignIn);

setInterval(checkSavedSignIn, 60000);
