#!/usr/bin/env node
/**
 * Embed a Windows .ico into a packaged .exe using `resedit` (pure JS) — the same
 * library electron-builder uses internally.
 *
 * Why this exists: this app has NO code-signing certificate, so electron-builder's
 * `signAndEditExecutable: true` (which does icon-edit AND sign in one step) aborts
 * when signtool fails on the unsigned bundled exes. We therefore keep
 * `signAndEditExecutable: false` (electron-builder leaves the exe untouched — the
 * known-working unsigned build) and embed the iERP icon ourselves in the afterPack
 * hook. No signing involved.
 */
const fs = require('fs');
const ResEdit = require('resedit');

/**
 * Replace the icon resource of `exePath` with the icons from `icoPath`.
 * @param {string} exePath  absolute path to the .exe to modify (in place)
 * @param {string} icoPath  absolute path to a .ico file
 */
function embedIcon(exePath, icoPath) {
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath));
  const res = ResEdit.NtExecutableResource.from(exe);
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
  const icons = iconFile.icons.map((i) => i.data);

  // Replace every existing icon group (Electron ships group id 1) so the new
  // icon shows everywhere the OS reads it. Fall back to id 1 / en-US if none.
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  if (groups.length === 0) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, icons);
  } else {
    for (const g of groups) {
      ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, g.id, g.lang, icons);
    }
  }

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
}

module.exports = { embedIcon };

if (require.main === module) {
  const [, , exePath, icoPath] = process.argv;
  if (!exePath || !icoPath) {
    console.error('Usage: node embed-win-icon.js <exePath> <icoPath>');
    process.exit(1);
  }
  embedIcon(exePath, icoPath);
  console.log(`embedded ${icoPath} -> ${exePath}`);
}
