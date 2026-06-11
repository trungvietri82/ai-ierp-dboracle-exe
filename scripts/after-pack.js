'use strict';
const path = require('path');
const { embedIcon } = require('./embed-win-icon');

// Embed the iERP icon into the packaged .exe (no signing — see embed-win-icon.js).
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const ico = path.join(__dirname, '..', 'resources', 'icon-win.ico');
  try {
    embedIcon(exe, ico);
    console.log('  ✓ embedded iERP icon into', path.basename(exe));
  } catch (e) {
    console.error('  ⚠ icon embed failed:', e.message);
  }
};
