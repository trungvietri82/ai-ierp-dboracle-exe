'use strict';
// Embed a .ico into a Windows .exe with `resedit` (no signing). Used because this
// app has no code-signing cert, so electron-builder's signAndEditExecutable is
// false and would otherwise leave the stock Electron icon on the exe.
const fs = require('fs');
const ResEdit = require('resedit');

function embedIcon(exePath, icoPath) {
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath));
  const res = ResEdit.NtExecutableResource.from(exe);
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
  const icons = iconFile.icons.map((i) => i.data);
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
