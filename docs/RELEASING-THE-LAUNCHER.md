# Releasing the launcher (self-update through GitHub)

Installed launchers update themselves from the **latest GitHub release** of `ilusixn/CoACustomRaces-Launcher`
(electron-updater, provider `github`, configured in `conquest-launcher/package.json` under `build.publish`).
They check 5 seconds after start and every 4 hours, download in the background, then show **Restart to install**.

## Why `latest.yml` matters

The updater does not look at the installer. It downloads `latest.yml` from the latest release, compares its
`version:` with the running launcher and, only when it is higher, downloads the file named in it and checks its
`sha512`. A release with just the installer is invisible to it, so nobody would be updated. Every release must
carry **three files**: the installer, its `.blockmap` (lets the updater download only the changed parts) and `latest.yml`.

## Steps

1. Bump the version (the number must be higher than the last release, or nobody updates):
   ```bash
   cd conquest-launcher
   npm version <x.y.z> --no-git-tag-version   # package.json + package-lock.json
   ```
   Add an entry to `changelogEntries` in `public/app.js` (and its translations in `localization/*.json`, then
   `node tools/generate-locales.cjs`).
2. Test and build (only one build at a time; they share `dist/`):
   ```bash
   npm test
   npm run build
   ```
   The build ends by printing the folder `dist/github-release`. It holds exactly the three upload files:
   `CoACustomRacesSetup-<x.y.z>.exe`, `CoACustomRacesSetup-<x.y.z>.exe.blockmap`, `latest.yml`.
   (`prepare-release.cjs` refuses to continue if `latest.yml` does not match the installer's version, name and hash.)
3. Publish (ask the owner first; this is public):
   ```bash
   gh release create v<x.y.z> dist/github-release/* --repo ilusixn/CoACustomRaces-Launcher --latest --title "Launcher <x.y.z>" --notes "<what changed>"
   ```
   Keep the tag `v<x.y.z>` equal to the version in `package.json`. Do not mark it pre-release or draft: the updater
   only follows the release flagged latest.
4. Verify:
   ```bash
   gh release view v<x.y.z> --repo ilusixn/CoACustomRaces-Launcher --json assets --jq '.assets[].name'   # the 3 files
   curl -sL https://github.com/ilusixn/CoACustomRaces-Launcher/releases/latest/download/latest.yml           # version: <x.y.z>
   ```
   Then start an older installed launcher: after about 5 seconds the bell shows the launcher update, and
   Server > Launcher > "Check for updates" reports it.

## Rules

- Never replace the files of a release that was already published: users may have cached them and the hash would
  mismatch. Publish a new version instead.
- The first release (1.0.0) shipped without `latest.yml`, so a 1.0.0 launcher can only learn about 1.0.1 if
  the 1.0.1 release has it. From then on every release does.
- Releases are not code-signed; the updater trusts GitHub plus the `sha512` in `latest.yml`.
