// Copyright (C) 2026 Duff (Duff-SPP). GPL-3.0-only; see LICENSE and ATTRIBUTION.md at the repository root.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { hashFile } = require('../src/release-format.cjs');

// Pinned upstream templates: fail the build if electron-builder changes these
// control flows. Re-review the upstream changes rather than silently reintroducing
// recursive deletion or execution of an unsafe legacy uninstaller.
const templates = {
  'installer.nsi': '8811964416d122612c3e7601728af5d3f998d677918df829a4e8b4c739c8b9f8',
  'installSection.nsh': '74c4dbb4163cdd90ca4850b75d304e916235c882d6af7b5cdad63bffbc977072',
  'uninstaller.nsh': '9ee2dac4593478083e8aa6f8487287ce9401006ccd50ecc538871d133ea4a42c',
  'include/installer.nsh': '0e319437dd01dcbf911f3f48f664fde0cefbaef704f1cdb1739f63d563f5d4a0',
  'include/installUtil.nsh': '97bd546b5cd2aaf16b77bc9e2be8a18962dd74ab5c4d23b35b163ca89bf4dd2a',
};
async function generate(appOutDir, buildDir, templateDir) {
  const files = []; const directories = new Set();
  async function walk(folder, prefix = '') {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isSymbolicLink()) throw new Error('Linked installer payload: ' + relative);
      if (/[\r\n|]/.test(relative) || relative.length > 220) throw new Error('Unsupported installer payload path: ' + relative);
      if (entry.isDirectory()) { directories.add(relative); await walk(path.join(folder, entry.name), relative + '\\'); }
      else if (entry.isFile()) files.push({ path: relative, hash: await hashFile(path.join(folder, entry.name)) });
      else throw new Error('Unsupported installer payload entry: ' + relative);
    }
  }
  await walk(appOutDir);
  if (!files.some(file => file.path === 'CoACustomRacesLauncher.exe') || !files.some(file => file.path === 'resources\\app.asar')) throw new Error('Incomplete launcher payload.');
  await fs.mkdir(buildDir, { recursive: true });
  const writeLines = (file, lines) => fs.writeFile(path.join(buildDir, file), '\ufeff' + lines.join('\r\n') + '\r\n', 'utf16le');
  await writeLines('coa-owned.txt', files.sort((a, b) => a.path.localeCompare(b.path)).map(file => `${file.hash}|${file.path}`));
  await writeLines('coa-dirs.txt', [...directories].sort((a, b) => b.split('\\').length - a.split('\\').length || a.localeCompare(b)));
  const sources = {};
  for (const [name, hash] of Object.entries(templates)) {
    const bytes = await fs.readFile(path.join(templateDir, name));
    if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error(`Installer template changed: ${name}. Review preservation integration before building.`);
    sources[name] = bytes.toString('utf8').replace(/\r\n/g, '\n');
  }
  const original = '!insertmacro uninstallOldVersion SHELL_CONTEXT\n!insertmacro handleUninstallResult SHELL_CONTEXT\n\n${if} $installMode == "all"\n  !insertmacro uninstallOldVersion HKEY_CURRENT_USER\n  !insertmacro handleUninstallResult HKEY_CURRENT_USER\n${endIf}';
  if (!sources['installSection.nsh'].includes(original)) throw new Error('Legacy upgrade block not found.');
  sources['installSection.nsh'] = sources['installSection.nsh'].replace(original, '!insertmacro coaPrepareUpgrade');
  sources['installSection.nsh'] = sources['installSection.nsh'].replace('!include installer.nsh', '!include "${BUILD_RESOURCES_DIR}\\safe-files.nsh"');
  // Custom NSIS scripts build their uninstaller at install time. Preserve the
  // upstream extraction logic but use WriteUninstaller instead of an external EXE.
  sources['safe-files.nsh'] = sources['include/installer.nsh'].replace('File "/oname=${UNINSTALL_FILENAME}" "${UNINSTALLER_OUT_FILE}"', 'WriteUninstaller "$INSTDIR\\${UNINSTALL_FILENAME}"');
  delete sources['include/installer.nsh'];
  const util = sources['include/installUtil.nsh'];
  sources['safe-util.nsh'] = util.slice(0, util.indexOf('Function GetInQuotes')) + util.slice(util.indexOf('Var /GLOBAL isTryToKeepShortcuts'), util.indexOf('Function handleUninstallResult'));
  delete sources['include/installUtil.nsh'];
  // AppData belongs to the player even if --delete-app-data is passed externally.
  const uninstaller = sources['uninstaller.nsh'];
  const begin = uninstaller.indexOf('  Var /GLOBAL isDeleteAppData');
  const end = uninstaller.indexOf('  DeleteRegKey SHELL_CONTEXT', begin);
  if (begin < 0 || end < 0) throw new Error('AppData removal block not found.');
  sources['uninstaller.nsh'] = uninstaller.slice(0, begin) + '  ; Player AppData is always preserved.\n\n' + uninstaller.slice(end);
  const removal = sources['uninstaller.nsh'];
  const removeStart = removal.indexOf('  # delete the installed files');
  const removeEnd = removal.indexOf('  ${ifNot} ${isKeepShortcuts}', removeStart);
  if (removeStart < 0 || removeEnd < 0) throw new Error('Default removal block not found.');
  sources['uninstaller.nsh'] = removal.slice(0, removeStart) + '  !insertmacro customRemoveFiles\n\n' + removal.slice(removeEnd);
  const functions = sources['uninstaller.nsh'];
  sources['uninstaller.nsh'] = functions.slice(0, functions.indexOf('Function un.atomicRMDir')) + functions.slice(functions.indexOf('!ifndef UNINSTALL_SECTION_NAME'));
  // Keep the original uninstaller directory, including when registry state or
  // payload files are missing. initMultiUser selects registry/shell context only.
  const initMultiUser = '  !insertmacro initMultiUser\n\n  !ifmacrodef customUnInit';
  if (!sources['uninstaller.nsh'].includes(initMultiUser)) throw new Error('Uninstaller initMultiUser block not found.');
  sources['uninstaller.nsh'] = sources['uninstaller.nsh'].replace(initMultiUser,
    '  StrCpy $coaInitialInstDir "$INSTDIR"\n  !insertmacro initMultiUser\n  StrCpy $INSTDIR "$coaInitialInstDir"\n\n  !ifmacrodef customUnInit');
  // Never unregister a different installation selected by stale registry state.
  const registryStart = '  DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}"';
  const registryEnd = '  DeleteRegKey SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}"';
  const un = sources['uninstaller.nsh'];
  const rs = un.indexOf(registryStart), re = un.indexOf(registryEnd, rs) + registryEnd.length;
  if (rs < 0 || re < registryEnd.length) throw new Error('Uninstaller registry cleanup block not found.');
  sources['uninstaller.nsh'] = un.slice(0, rs)
    + '  ReadRegStr $R0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation\n  ReadRegStr $R1 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" DisplayIcon\n  ${If} $R0 == $INSTDIR\n  ${OrIf} $R1 == "$INSTDIR\\${APP_EXECUTABLE_FILENAME},0"\n'
    + un.slice(rs, re) + '\n  ${EndIf}' + un.slice(re);

  // Use explicit paths so upstream include search order cannot select unsafe code.
  // A custom NSIS script is compiled as one installer script here. The installer
  // portion is emitted first; BUILD_UNINSTALLER is then defined at the bottom so
  // WriteUninstaller can embed our uninstall sections. Do not convert this to the
  // stock two-pass include pattern unless the custom-script build strategy changes.
  sources['installer.nsi'] = sources['installer.nsi']
    .replace('!include "common.nsh"', '!include "common.nsh"\n!insertmacro coaFunctions ""')
    .replace('!include "installUtil.nsh"', '!include "${BUILD_RESOURCES_DIR}\\safe-util.nsh"')
    .replace('!include "installSection.nsh"', '!include "${BUILD_RESOURCES_DIR}\\safe-installSection.nsh"')
    .replace('!include "assistedInstaller.nsh"', '!include "assistedInstaller.nsh"\n  !insertmacro MUI_UNPAGE_WELCOME\n  !insertmacro MUI_UNPAGE_INSTFILES\n  !insertmacro MUI_UNPAGE_FINISH')
    .replace('!ifdef BUILD_UNINSTALLER\n  !include "uninstaller.nsh"\n!endif', '!define BUILD_UNINSTALLER\n!insertmacro coaFunctions "un."\n!include "${BUILD_RESOURCES_DIR}\\safe-uninstaller.nsh"');
  // The upstream wrapper declares globals on every expansion. Our combined
  // installer/uninstaller script must call the custom check directly.
  for (const name of ['installSection.nsh', 'uninstaller.nsh']) {
    sources[name] = sources[name].replaceAll('!insertmacro CHECK_APP_RUNNING', '!insertmacro customCheckAppRunning');
  }
  for (const [name, source] of Object.entries(sources)) await fs.writeFile(path.join(buildDir, name.startsWith('safe-') ? name : 'safe-' + name), source);
  return files;
}

module.exports = async context => {
  if (context.electronPlatformName !== 'win32') throw new Error('Installer preservation is configured for Windows only.');
  const root = path.resolve(__dirname, '..');
  const files = await generate(context.appOutDir, path.join(root, 'build'), path.join(root, 'node_modules/app-builder-lib/templates/nsis'));
  console.log(`Prepared hash-based installer ownership for ${files.length} files.`);
};
module.exports.generate = generate;
