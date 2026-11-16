# CoA Custom Races Launcher

**Modified version** of Conquest Launcher, originally developed by **Duff (Duff-SPP)**:
https://github.com/Duff-SPP/ConquestOfAzerothCoreLauncher. Changed by ilusixn, November 2026. GPL-3.0-only, with the
attribution terms in [ATTRIBUTION.md](ATTRIBUTION.md).

What this edition adds (code in `conquest-launcher/src/coa-custom.cjs`):

* **Original client**: still downloads and updates the game client from the original Conquest of AzerothCore release service.
* **Create server**: downloads the latest public CoA server build ([Corfirean/coa-server-build](https://github.com/Corfirean/coa-server-build)), checks every part's SHA-256, unpacks it and prepares its configuration. **Start** / **Stop** use the server's own `Scripts/manage.py`.
* **Apply modules**: on/off switches for
  * **SquidBots**: SQUID Playerbots (always the version shipped with the latest server) plus the latest [SquidBots addon](https://github.com/Zyth45/squidbots-addon). Off = no bots.
  * **ilusixn Dev Menu**: the [/dev addon](https://github.com/ilusixn/ilusixn-dev-menu). Its server module needs a worldserver built with it.
  * **CoA Custom Races V2**: turns custom races on in the server and installs the [V2 client files](https://github.com/ilusixn/CustomRacesCoa/releases/tag/coa-custom-2.0); the game then starts with `CoACustomRace.exe`.
* **Realmlist**: Local, LAN, LogMeIn Hamachi (addresses detected automatically) or Join a friend. Hosting also sets the realm address the server hands out.
* **Play on my own server**: no coa-development.org account needed.
* **Buy me a coffee**: https://buymeacoffee.com/ilusixne

---

# Conquest Launcher

[![Stars](https://img.shields.io/github/stars/Duff-SPP/ConquestOfAzerothCoreLauncher?style=flat)](https://github.com/Duff-SPP/ConquestOfAzerothCoreLauncher/stargazers)
[![Forks](https://img.shields.io/github/forks/Duff-SPP/ConquestOfAzerothCoreLauncher?style=flat)](https://github.com/Duff-SPP/ConquestOfAzerothCoreLauncher/forks)

[Who starred](https://github.com/Duff-SPP/ConquestOfAzerothCoreLauncher/stargazers) · [Forks and their owners](https://github.com/Duff-SPP/ConquestOfAzerothCoreLauncher/forks) · [Traffic (maintainers)](https://github.com/Duff-SPP/ConquestOfAzerothCoreLauncher/graphs/traffic)

An Electron launcher and .NET backend for Conquest of AzerothCore, originally developed by **Duff (Duff-SPP)**.

The launcher installs and repairs the game client, manages updates and download speed, supports account sign-in and optional game auto-login, and includes a talent builder. The source includes the interface images, icons, fonts, sound, backend, tests and build tools.

## Build

Requirements: Windows x64, Git, **Node.js 22+**, Windows `tar.exe`, and **.NET SDK 8** for backend builds. Keep npm optional dependencies enabled; the launcher uses Koffi's prebuilt Windows library.

```powershell
git clone https://github.com/Duff-SPP/ConquestOfAzerothCoreLauncher.git
cd ConquestOfAzerothCoreLauncher
cd conquest-launcher
npm.cmd ci
cd ..
& '.\Launcher Manager.bat'
```

Useful manager options:

| Option | Action |
| --- | --- |
| 2 | Build the Windows installer at the current version |
| 3 | Create a hotfix package from an existing launcher build |
| 4 | Build the Linux backend |
| U | Build and package a backend update for an existing installation |
| 7 | Install locked npm dependencies |
| 8 | Check prerequisites |

Installers are written to `conquest-launcher/dist/`; delivery packages go in `Release-Output/`. See [Launcher Manager](LAUNCHER_MANAGER.md) for the complete menu and [Build and Release](BUILD_AND_RELEASE.md) for manual commands.

## Use it for your project

Before running the launcher, configure your own services:

1. Update `conquest-launcher/launcher.config.json`. Use `launcher.config.example.json` as a starting point. Set your API, client manifest, game realmlist and community/account URLs.
2. Update the app identity, icons and launcher update feed in `conquest-launcher/package.json`.
3. Configure the backend using its example settings and your existing AzerothCore auth/characters databases. Keep real credentials in environment variables, user secrets or ignored local settings.
4. Supply the game client and addons you are allowed to distribute. Game executables, game archives and player data are not included. The empty addon catalog can be built as-is.

The checked-in configuration points to the original project's public services. Replace those addresses for your fork. Choose a new version before publishing changed binaries.

### Accounts and 2FA

The original deployment uses a separate website service for authentication. Its source is not included here. The launcher API contract is documented in [Authentication](docs/AUTHENTICATION.md).

The bundled backend supports basic SRP account login but **does not validate TOTP or recovery codes**. Accounts requiring 2FA need an authentication service that implements the documented contract.

### Images and other assets

The UI and builder assets are in `conquest-launcher/public/`. Third-party artwork, fonts, trademarks and dependencies retain their own rights; see [Third-party Notices](THIRD_PARTY_NOTICES.md). The code license does not grant rights to every included third-party asset.

## Run and test

After configuring your services:

```powershell
cd conquest-launcher
npm.cmd start
npm.cmd test
```

Some tests generate local production bundles. Manual smoke scripts may require compiled artifacts. The backend-updater fixture test needs Python 3; set `COA_TEST_PYTHON` if Python is not on PATH.

## Deploy

- [Production deployment](PRODUCTION_DEPLOYMENT.md): new Ubuntu 26.04 host with existing Nginx and MySQL/MariaDB.
- [Launcher updates](conquest-launcher/LAUNCHER_DEPLOYMENT.md): publish an installer and its update feed.
- [Existing backend updates](UPDATE_0.8.1.md): update the original installation while preserving its configuration and authentication routing.
- [Security](SECURITY.md): private configuration and reporting vulnerabilities.

The installer and updater use the original project's paths and service layout. Review them before running them on another host. Build, package and publish are separate steps.

## License and credit

Original code is licensed under **GPLv3-only with author-attribution and origin terms**. See [LICENSE](LICENSE), [COPYING](COPYING) and [ATTRIBUTION.md](ATTRIBUTION.md).

You may fork, rename and modify the launcher. Distributed forks must provide the corresponding source under the license, identify their changes and preserve an accessible original-author credit:

> Originally developed by Duff (Duff-SPP) as Conquest Launcher.

You can add your own credits for your modifications. The software is provided without warranty.
