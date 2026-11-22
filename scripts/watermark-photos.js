#!/usr/bin/env node
/**
 * Prepare photos for the site: crop to 9:16, resize, stamp "Quy Nhon Life"
 * in the bottom left corner, and remove everything the camera wrote into the
 * file (date, phone model, location).
 *
 *   node scripts/watermark-photos.js assets/photos/tanker.jpg
 *   node scripts/watermark-photos.js assets/photos/tanker.jpg --name tanker-at-dawn --focus-x 0.7
 *   node scripts/watermark-photos.js assets/photos/*.jpg
 *
 * Options:
 *   --name <slug>     Output name. Only with one input. Default: the file name.
 *   --focus-x <0..1>  Which part to keep when the photo is wider than 9:16
 *                     (0 = left edge, 0.5 = centre, 1 = right edge). Default 0.5.
 *   --focus-y <0..1>  The same for a photo taller than 9:16 (0 = top). Default 0.5.
 *   --ink <auto|white|dark>  Colour of the mark. auto measures the corner and
 *                     picks whichever reads better. Default auto.
 *   --out <dir>       Where to write. Default public/img/photos.
 *
 * Each photo comes out as <name>-1080.jpg (1080 x 1920) and <name>-540.jpg.
 * The mark is part of the picture, so it stays when someone saves or shares it.
 *
 * Originals stay in assets/photos/, which is not in the public repository:
 * they can carry the place and time they were taken.
 *
 * Needs ffmpeg on the PATH. No npm packages.
 *
 * The mark itself is scripts/watermark/wordmark-mask.png (white on black, used
 * as a transparency mask). To make it again after a logo change, render
 * scripts/watermark/wordmark.html in headless Chrome at 1500 x 320 and trim
 * it to the letters:
 *   chrome --headless=new --window-size=1500,320 --virtual-time-budget=10000 \
 *     --screenshot=raw.png file:///.../scripts/watermark/wordmark.html
 *   ffmpeg -i raw.png -vf "crop=1262:182:123:81,format=gray" scripts/watermark/wordmark-mask.png
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MASK = path.join(HERE, 'watermark', 'wordmark-mask.png');
const MASK_W = 1262;
const MASK_H = 182;

const OUT_W = 1080;
const OUT_H = 1920;
const MARK_W = Math.round(OUT_W * 0.36);                 // 36% of the photo's width
const MARK_H = 2 * Math.round((MARK_W * MASK_H) / MASK_W / 2);
// The photo frames zoom 5% on hover and clip the edges, so keep clear of them.
const INSET = Math.round(OUT_W * 0.06);
const MARK_X = INSET;
const MARK_Y = OUT_H - INSET - MARK_H;

const WHITE = '0xffffff';
const DARK = '0x0b1d24';        // the site's dark ink
// Corner brightness (0 to 255) at which the mark switches from white to dark.
const DARK_INK_ABOVE = 150;

// ── Arguments ──
const inputs = [];
const opt = { 'focus-x': '0.5', 'focus-y': '0.5', ink: 'auto', out: 'public/img/photos' };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) { inputs.push(a); continue; }
  const eq = a.indexOf('=');
  if (eq > -1) opt[a.slice(2, eq)] = a.slice(eq + 1);
  else opt[a.slice(2)] = argv[++i];
}
function fail(msg) { console.error(msg); process.exit(1); }
const unit = (name) => {
  const n = Number(opt[name]);
  if (!(n >= 0 && n <= 1)) fail(`--${name} must be a number from 0 to 1`);
  return n;
};

if (!inputs.length) fail('Usage: node scripts/watermark-photos.js <photo> [more photos] [--name slug] [--focus-x 0..1] [--focus-y 0..1] [--ink auto|white|dark] [--out dir]');
if (opt.name && inputs.length > 1) fail('--name only works with one photo');
if (!['auto', 'white', 'dark'].includes(opt.ink)) fail('--ink must be auto, white or dark');
if (!fs.existsSync(MASK)) fail(`Missing ${MASK}`);
const FX = unit('focus-x');
const FY = unit('focus-y');
fs.mkdirSync(opt.out, { recursive: true });

const slug = (file) => path.basename(file, path.extname(file)).toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const ffmpeg = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 1 << 26 });

// Crop to 9:16 around the focus point. iw and ih are read after ffmpeg has
// turned a sideways camera file upright.
const CROP = `crop=w='min(iw,ih*9/16)':h='min(ih,iw*16/9)':x='(iw-ow)*${FX}':y='(ih-oh)*${FY}'`;

/**
 * Which colours the file's numbers mean. Phones save in Display P3, which has
 * wider colours than the web's standard (sRGB). The colour profile is removed
 * with the rest of the metadata, so P3 photos are converted to sRGB first or
 * they would come out duller than the original.
 */
function colourProfile(file) {
  const buf = fs.readFileSync(file);
  const at = buf.indexOf('ICC_PROFILE');
  if (at < 0) return 'srgb';
  const text = buf.subarray(at, at + 4000).toString('latin1').replace(/\0/g, '');
  if (/Display P3|P3 Gamut|DCI-P3/i.test(text)) return 'p3';
  if (/sRGB|IEC ?61966/i.test(text)) return 'srgb';
  return 'unknown';
}

/** Average brightness (0 to 255) of the corner the mark will sit on. */
function cornerBrightness(file) {
  const out = ffmpeg(['-i', file, '-vf',
    `${CROP},scale=${OUT_W}:${OUT_H}:flags=bicubic,crop=${MARK_W}:${MARK_H}:${MARK_X}:${MARK_Y},scale=1:1:flags=area,format=gray`,
    '-frames:v', '1', '-f', 'rawvideo', 'pipe:1']);
  return out[0];
}

for (const file of inputs) {
  if (!fs.existsSync(file)) fail(`Not found: ${file}`);
  const name = opt.name || slug(file);
  const profile = colourProfile(file);
  if (profile === 'unknown') fail(`${file}: unfamiliar colour profile. Export it as sRGB or Display P3 first.`);

  const brightness = cornerBrightness(file);
  const ink = opt.ink === 'auto' ? (brightness >= DARK_INK_ABOVE ? 'dark' : 'white') : opt.ink;

  // To RGB. For Display P3 that includes the conversion to sRGB.
  const toRgb = profile === 'p3'
    ? 'setparams=color_primaries=smpte432:color_trc=iec61966-2-1,zscale=primaries=709:transfer=iec61966-2-1:matrix=gbr:range=full,format=gbrp'
    : 'format=gbrp';

  // White ink gets a faint soft shadow so it holds on mid tones. Dark ink
  // only goes on a pale corner and needs none.
  const shadow = ink === 'white'
    ? `[m0]split[m][ms];color=c=black:s=${MARK_W}x${MARK_H},format=rgb24[sk];[ms]gblur=sigma=5[msb];[sk][msb]alphamerge,colorchannelmixer=aa=0.35[sh];[base][sh]overlay=x=${MARK_X}:y=${MARK_Y + 1}:format=auto[base2];`
    : '[m0]null[m];[base]null[base2];';

  const graph = [
    `[0:v]${CROP},${toRgb},scale=${OUT_W}:${OUT_H}:flags=lanczos[base];`,
    `[1:v]scale=${MARK_W}:${MARK_H}:flags=lanczos,format=gray[m0];`,
    shadow,
    `color=c=${ink === 'white' ? WHITE : DARK}:s=${MARK_W}x${MARK_H},format=rgb24[ik];`,
    `[ik][m]alphamerge,colorchannelmixer=aa=${ink === 'white' ? 0.94 : 0.88}[wm];`,
    `[base2][wm]overlay=x=${MARK_X}:y=${MARK_Y}:format=auto,sidedata=mode=delete:type=ICC_PROFILE,split[big][s0];`,
    `[big]scale=${OUT_W}:${OUT_H}:out_color_matrix=bt601:out_range=pc,format=yuvj420p[o1];`,
    `[s0]scale=${OUT_W / 2}:${OUT_H / 2}:flags=lanczos:out_color_matrix=bt601:out_range=pc,format=yuvj420p[o2]`,
  ].join('');

  const jpeg = ['-frames:v', '1', '-update', '1', '-c:v', 'mjpeg', '-huffman', 'optimal',
    '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:v', '+bitexact'];
  const big = path.join(opt.out, `${name}-${OUT_W}.jpg`);
  const small = path.join(opt.out, `${name}-${OUT_W / 2}.jpg`);
  ffmpeg(['-i', file, '-i', MASK, '-filter_complex', graph,
    '-map', '[o1]', ...jpeg, '-q:v', '3', big,
    '-map', '[o2]', ...jpeg, '-q:v', '3', small]);

  // Nothing from the camera may be left in what gets published.
  for (const f of [big, small]) {
    const b = fs.readFileSync(f);
    for (const marker of ['Exif', 'ICC_PROFILE', 'http://ns.adobe.com/xap', 'GPS']) {
      if (b.includes(marker)) fail(`${f} still contains ${marker} data. Do not publish it.`);
    }
  }
  const kb = (f) => Math.round(fs.statSync(f).size / 1024);
  console.log(`${path.basename(file)} -> ${big} (${kb(big)} KB), ${small} (${kb(small)} KB)`
    + `  [${profile === 'p3' ? 'Display P3 converted to sRGB' : 'sRGB'}, corner brightness ${brightness}, ${ink} mark]`);
}
