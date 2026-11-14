// Copyright (C) 2026 Duff (Duff-SPP). GPL-3.0-only; see LICENSE and ATTRIBUTION.md at the repository root.
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const asar = require('@electron/asar');
const { createHash } = require('node:crypto');
const { NtExecutable, NtExecutableResource } = require('resedit');
const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');
const { bundleNames } = require('./production-bundles.cjs');
const builderData = 'public/builder/data/coa-data.js';
const expectedScripts = [...bundleNames, builderData];

const expectedFuses = {
  RunAsNode: false, EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false, EnableEmbeddedAsarIntegrityValidation: true,
  OnlyLoadAppFromAsar: true,
};
async function inspect(appOutDir) {
  const archive = path.join(appOutDir, 'resources/app.asar');
  // @electron/asar 3.x resolves member paths using the host path separator.
  const statFile = name => asar.statFile(archive, path.normalize(name));
  const extractFile = name => asar.extractFile(archive, path.normalize(name));
  const entries = asar.listPackage(archive).map(name => name.replaceAll('\\', '/').replace(/^\//, ''));
  const files = entries.filter(name => !statFile(name).files);
  for (const name of files) {
    assert.match(name, /^(package\.json|launcher\.config\.json|runtime\/|public\/|node_modules\/)/, `Unexpected production file: ${name}`);
    assert.doesNotMatch(name, /\.map$/i, `Source map leak: ${name}`);
    if (!name.startsWith('node_modules/')) assert.doesNotMatch(name, /(^|\/)(src|test|tools|reference)\//i, `Source leak: ${name}`);
  }
  const firstPartyScripts = files.filter(name => !name.startsWith('node_modules/') && /\.(cjs|mjs|js)$/.test(name)).sort();
  assert.deepEqual(firstPartyScripts, [...expectedScripts].sort());
  const metadata = JSON.parse(extractFile('package.json'));
  assert.equal(metadata.main, 'runtime/a.cjs');
  for (const name of expectedScripts) {
    const contents = extractFile(name).toString('utf8');
    assert.doesNotMatch(contents, /sourceMappingURL|sourcesContent|src\/client-updater\.cjs|class ClientUpdater|function submitBugReport/);
    const stat = statFile(name);
    assert.equal(!!stat.unpacked, false, `${name} must remain inside ASAR`);
    assert.equal(stat.integrity.algorithm, 'SHA256');
    assert.equal(stat.integrity.hash, createHash('sha256').update(contents).digest('hex'));
  }
  const html = extractFile('public/index.html').toString('utf8');
  assert.deepEqual([...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1]), ['builder/data/coa-data.js', 'c.js']);
  const fuses = await getCurrentFuseWire(path.join(appOutDir, 'CoACustomRacesLauncher.exe'));
  for (const [name, enabled] of Object.entries(expectedFuses)) assert.equal(fuses[FuseV1Options[name]], enabled ? 49 : 48, `Incorrect Electron fuse: ${name}`);
  const executable = NtExecutable.from(await fs.readFile(path.join(appOutDir, 'CoACustomRacesLauncher.exe')));
  const resource = NtExecutableResource.from(executable).entries.find(entry => entry.type === 'INTEGRITY' && entry.id === 'ELECTRONASAR');
  assert.ok(resource, 'Missing Windows ASAR integrity resource');
  const integrity = JSON.parse(Buffer.from(resource.bin).toString('utf8')).find(entry => entry.file.replaceAll('\\', '/') === 'resources/app.asar');
  assert.equal(integrity?.alg, 'SHA256');
  assert.equal(integrity.value, createHash('sha256').update(asar.getRawHeader(archive).headerString).digest('hex'));
  // Make sure the archive is the same bytes produced by this build, not stale output.
  for (const name of expectedScripts) assert.deepEqual(extractFile(name), await fs.readFile(path.resolve(__dirname, '../.production', name)));
  return { version: metadata.version, firstPartyScripts, fileCount: files.length, sourceMaps: 0, embeddedIntegrity: 'verified', fuses: expectedFuses };
}

module.exports = async context => {
  console.log('Protected package verified:', JSON.stringify(await inspect(context.appOutDir)));
  // Ownership hashes must be generated AFTER fuse/integrity changes to the EXE.
  await require('./installer-ownership.cjs')(context);
};
module.exports.inspect = inspect;
module.exports.expectedFuses = expectedFuses;
if (require.main === module) inspect(path.resolve(process.argv[2] || path.join(__dirname, '../dist/win-unpacked'))).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error); process.exitCode = 1; });
