#!/usr/bin/env node
/**
 * Prepare the pre-bundled runtime for the pptx / html2pptx skill so PowerPoint
 * generation works OFFLINE (no npm install / no playwright download at run time).
 *
 * Produces resources/pptx-runtime/ containing:
 *   - node_modules: pptxgenjs, playwright(+core), sharp, react-icons, react, react-dom
 *   - node_modules/playwright-core/.local-browsers: a single full chromium build
 *     (PLAYWRIGHT_BROWSERS_PATH=0 keeps browsers inside the package = relocatable)
 *
 * The agent runs the html2pptx workflow with the BUNDLED node (resources/node),
 * so native deps (sharp) MUST be installed with that node's ABI. We therefore
 * shell out to the bundled npm. The generated folder is gitignored and shipped
 * via electron-builder extraResources (-> <app>/resources/pptx-runtime).
 *
 * Idempotent: skips work if a chromium build + pptxgenjs already exist.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const RUNTIME_DIR = path.join(PROJECT_ROOT, 'resources', 'pptx-runtime');
const NM = path.join(RUNTIME_DIR, 'node_modules');
const BROWSERS_DIR = path.join(NM, 'playwright-core', '.local-browsers');

const PKG = {
  name: 'pptx-runtime',
  version: '1.0.0',
  private: true,
  description: 'Pre-bundled offline deps for the pptx/html2pptx skill',
  dependencies: {
    pptxgenjs: '^3.12.0',
    playwright: '^1.49.0',
    sharp: '^0.33.5',
    'react-icons': '^5.3.0',
    react: '^18.3.1',
    'react-dom': '^18.3.1',
  },
};

function log(msg) {
  console.log(`[prepare:pptx-runtime] ${msg}`);
}

/** Resolve the bundled node/npm for the host platform (matches the agent runtime). */
function resolveBundledNpm() {
  const platform = process.platform;
  const arch = process.arch;
  const base = path.join(PROJECT_ROOT, 'resources', 'node', `${platform}-${arch}`);
  if (platform === 'win32') {
    return { npm: path.join(base, 'npm.cmd'), npx: path.join(base, 'npx.cmd'), dir: base };
  }
  return { npm: path.join(base, 'bin', 'npm'), npx: path.join(base, 'bin', 'npx'), dir: path.join(base, 'bin') };
}

function hasChromium() {
  if (!fs.existsSync(BROWSERS_DIR)) return false;
  const entries = fs.readdirSync(BROWSERS_DIR);
  return entries.some((e) => /^chromium-\d+$/.test(e)) && fs.existsSync(path.join(NM, 'pptxgenjs'));
}

function run(cmd, args, extraEnv) {
  const res = spawnSync(cmd, args, {
    cwd: RUNTIME_DIR,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '0', ...extraEnv },
  });
  if (res.status !== 0) {
    throw new Error(`Command failed (${res.status}): ${cmd} ${args.join(' ')}`);
  }
}

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

/** Remove browser builds we do not use to cut size (Windows uses full chromium via executablePath). */
function pruneBrowsers() {
  if (!fs.existsSync(BROWSERS_DIR)) return;
  for (const entry of fs.readdirSync(BROWSERS_DIR)) {
    if (/^chromium_headless_shell-\d+$/.test(entry) || /^ffmpeg-\d+$/.test(entry)) {
      rmrf(path.join(BROWSERS_DIR, entry));
      log(`pruned ${entry}`);
    }
  }
}

function pruneTypes() {
  const types = path.join(NM, '@types');
  rmrf(types);
}

function main() {
  const { npm, npx } = resolveBundledNpm();
  if (!fs.existsSync(npm)) {
    console.warn(
      `[prepare:pptx-runtime] Bundled npm not found at ${npm}. Run "npm run download:node" first. Skipping.`
    );
    process.exit(0);
  }

  if (hasChromium()) {
    log('Already prepared (chromium + pptxgenjs present) — skipping.');
    pruneBrowsers();
    pruneTypes();
    return;
  }

  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.writeFileSync(path.join(RUNTIME_DIR, 'package.json'), JSON.stringify(PKG, null, 2));

  log('Installing deps with bundled npm (PLAYWRIGHT_BROWSERS_PATH=0)...');
  run(npm, ['install', '--no-audit', '--no-fund', '--omit=dev']);

  log('Installing chromium into the package...');
  run(npx, ['playwright', 'install', 'chromium']);

  pruneBrowsers();
  pruneTypes();
  log('Done. Offline pptx runtime ready at resources/pptx-runtime.');
}

main();
