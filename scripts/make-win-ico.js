#!/usr/bin/env node
/**
 * One-time generator: build a multi-size Windows .ico from a square PNG.
 *
 * No `sharp` at the repo root, so resizing uses Windows GDI+ (System.Drawing via
 * PowerShell, HighQualityBicubic) saved as 32-bpp BMP. Each BMP is repackaged
 * into a classic DIB icon entry (BITMAPINFOHEADER with doubled height for the
 * XOR colour bitmap + a zeroed 1-bpp AND mask — alpha carries transparency).
 *
 * DIB entries are chosen over PNG entries because PNG-in-.ico is only reliably
 * decoded at 256px; small PNG entries render as noise in GDI+/older loaders.
 *
 * Usage: node scripts/make-win-ico.js [srcPng] [outIco]
 *   defaults: resources/icon.png -> resources/icon-win.ico
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SIZES = [16, 24, 32, 48, 64, 128, 256];

/** Resize srcPng to size×size, save as a 32-bpp BMP at outBmp (via GDI+). */
function resizeToBmp(srcPng, size, outBmp) {
  const esc = (p) => p.replace(/\\/g, '\\\\');
  const ps = [
    'Add-Type -AssemblyName System.Drawing',
    `$src=[System.Drawing.Image]::FromFile('${esc(srcPng)}')`,
    `$bmp=New-Object System.Drawing.Bitmap(${size}, ${size}, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)`,
    '$g=[System.Drawing.Graphics]::FromImage($bmp)',
    '$g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic',
    '$g.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::HighQuality',
    '$g.PixelOffsetMode=[System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality',
    '$g.Clear([System.Drawing.Color]::Transparent)',
    `$g.DrawImage($src,0,0,${size},${size})`,
    `$bmp.Save('${esc(outBmp)}',[System.Drawing.Imaging.ImageFormat]::Bmp)`,
    '$g.Dispose();$bmp.Dispose();$src.Dispose()',
  ].join('; ');
  execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'pipe' });
}

/**
 * Turn a 32-bpp BMP file into a DIB icon image (the data stored in an ICONDIRENTRY):
 * BITMAPINFOHEADER (height doubled) + bottom-up BGRA XOR bitmap + zeroed AND mask.
 */
function bmpToDibIcon(bmpBuf, size) {
  // BITMAPFILEHEADER is 14 bytes; pixel offset is at byte 10.
  const pixelOffset = bmpBuf.readUInt32LE(10);
  const header = Buffer.from(bmpBuf.subarray(14, 54)); // 40-byte BITMAPINFOHEADER
  const bitCount = header.readUInt16LE(14);
  if (bitCount !== 32) {
    throw new Error(`expected 32-bpp BMP for ${size}px, got ${bitCount}-bpp`);
  }
  const xor = Buffer.from(bmpBuf.subarray(pixelOffset, pixelOffset + size * size * 4));

  // AND mask: 1 bpp, rows padded to 4 bytes, all zero (fully opaque; alpha does transparency).
  const andRowBytes = (((size + 31) >> 5) << 2);
  const andMask = Buffer.alloc(andRowBytes * size, 0);

  // Patch header: biHeight = 2*size (XOR + AND), biSizeImage = xor + and.
  const out = Buffer.from(header);
  out.writeInt32LE(size * 2, 8);
  out.writeUInt32LE(xor.length + andMask.length, 20);
  return Buffer.concat([out, xor, andMask]);
}

function assembleIco(items) {
  // items: [{ size, dib }]
  const N = items.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(N, 4);

  const dir = Buffer.alloc(16 * N);
  let offset = 6 + 16 * N;
  items.forEach((it, i) => {
    const o = i * 16;
    dir.writeUInt8(it.size >= 256 ? 0 : it.size, o + 0);
    dir.writeUInt8(it.size >= 256 ? 0 : it.size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4); // planes
    dir.writeUInt16LE(32, o + 6); // bit count
    dir.writeUInt32LE(it.dib.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += it.dib.length;
  });

  return Buffer.concat([header, dir, ...items.map((it) => it.dib)]);
}

function main() {
  const srcPng = path.resolve(process.argv[2] || 'resources/icon.png');
  const outIco = path.resolve(process.argv[3] || 'resources/icon-win.ico');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ico-'));
  const items = [];
  for (const size of SIZES) {
    const bmpPath = path.join(tmp, `${size}.bmp`);
    resizeToBmp(srcPng, size, bmpPath);
    items.push({ size, dib: bmpToDibIcon(fs.readFileSync(bmpPath), size) });
  }
  fs.writeFileSync(outIco, assembleIco(items));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`wrote ${outIco} with sizes: ${SIZES.join(', ')}`);
}

main();
