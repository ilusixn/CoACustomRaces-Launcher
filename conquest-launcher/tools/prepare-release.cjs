// Copyright (C) 2026 Duff (Duff-SPP). GPL-3.0-only; see LICENSE and ATTRIBUTION.md at the repository root.
const fs = require('node:fs/promises');
const path = require('node:path');
const { sha512 } = require('./publish-launcher.cjs');
async function prepare() {
  const root = path.resolve(__dirname, '..'); const version = require('../package.json').version;
  const file = `CoACustomRacesSetup-${version}.exe`;
  const dist = path.join(root, 'dist'); const bundle = path.join(dist, 'launcher-release');
  await fs.mkdir(bundle, { recursive: true });
  for (const name of [file, file + '.blockmap']) await fs.copyFile(path.join(dist, name), path.join(bundle, name));
  const latest = await fs.readFile(path.join(dist, 'latest.yml'), 'utf8');
  if (!latest.includes(`version: ${version}`) || !latest.includes(file) || !latest.includes(await sha512(path.join(bundle, file)))) throw new Error('electron-builder updater metadata does not match the installer.');
  await fs.writeFile(path.join(bundle, 'latest.yml'), latest);
  await fs.writeFile(path.join(bundle, 'launcher-release.json'), JSON.stringify({ version, file, size: (await fs.stat(path.join(bundle, file))).size, sha512: await sha512(path.join(bundle, file)), blockmapSha512: await sha512(path.join(bundle, file + '.blockmap')) }, null, 2));
  const operations = path.join(dist, 'release-tools');
  await fs.mkdir(path.join(operations, 'tools'), { recursive: true }); await fs.mkdir(path.join(operations, 'src'), { recursive: true });
  for (const name of ['publish-client.cjs', 'publish-launcher.cjs', 'release-manager.cjs', 'validate-master.cjs']) await fs.copyFile(path.join(root, 'tools', name), path.join(operations, 'tools', name));
  await fs.copyFile(path.join(root, 'src/release-format.cjs'), path.join(operations, 'src/release-format.cjs'));
  await fs.copyFile(path.join(root, 'RELEASING.md'), path.join(operations, 'RELEASING.md'));
  console.log(`Installer: ${path.join(dist, file)}\nUpload launcher-release and release-tools to the VPS. Read RELEASING.md for the one-time setup.`);
}
prepare().catch(error => { console.error(error.message); process.exitCode = 1; });
