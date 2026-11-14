// Copyright (C) 2026 Duff (Duff-SPP). GPL-3.0-only; see LICENSE and ATTRIBUTION.md at the repository root.
// CoA Custom Races edition (ilusixn): made for your own server, LAN or LogMeIn Hamachi, so there is no account
// sign-in. The launcher always opens; these stubs keep the original call sites working.
function syncAuthGate(account) {
  state.account = account || null;
  document.body.classList.remove('auth-locked');
  document.getElementById('auth-gate')?.remove();
  for (const element of document.querySelectorAll('.main-nav, .utilitybar, #main-content, footer')) element.inert = false;
}
async function checkSavedSignIn() { syncAuthGate(null); }
document.addEventListener('DOMContentLoaded', () => syncAuthGate(null));
