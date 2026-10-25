#!/usr/bin/env node
// Builds the deployable site into dist/.
//
//   node build.js                         asks for the first-date password
//   $env:SOFIA_PASSWORD='26/10'; node build.js   (PowerShell, no prompt)
//
// Reads private/content.js + private/photos + private/media, packs it all into one bundle,
// encrypts it (PBKDF2 → AES-GCM) into dist/payload.bin and copies the public page shell.
// The password is never written anywhere. No npm dependencies; photos are resized with ffmpeg.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { spawnSync } = require('child_process');
const DateKey = require('./date.js');

const ROOT = __dirname;
const PRIV = path.join(ROOT, 'private');
const DIST = path.join(ROOT, 'dist');
const CACHE = path.join(PRIV, '.cache');
const SECRET_FILE = path.join(PRIV, 'link-secret.txt');

const ITERATIONS = 300000;
const PHOTO_MAX_WIDTH = 1600;
const PHOTO_MAX_BYTES = 300 * 1024;
const VIDEO_MAX_BYTES = 8 * 1024 * 1024;
const AUDIO_MAX_BYTES = 3 * 1024 * 1024;
const PUBLIC_FILES = ['index.html', 'styles.css', 'script.js', 'date.js'];

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4',
};

const warnings = [];
const warn = (msg) => warnings.push(msg);

main().catch((err) => {
  console.error('\n✖ ' + err.message);
  process.exit(1);
});

async function main() {
  const content = loadContent();
  const dateKey = await getDateKey();
  const secret = getLinkSecret();
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) warn('ffmpeg not found: photos are copied without resizing. Install it with: winget install Gyan.FFmpeg');

  // 1. Collect media and the content that references it
  const media = [];
  const addMedia = (bytes, type) => {
    const id = 'm' + media.length;
    media.push({ id, bytes, type });
    return id;
  };
  const addPhoto = (file) => {
    const p = preparePhoto(file, ffmpeg);
    return addMedia(p.bytes, p.type);
  };

  const photos = content.photos.map((p) => ({
    media: addPhoto(p.file),
    caption: p.caption || '',
  }));

  const clip = prepareClip(content.clip);
  const clipOut = {
    type: content.clip.type,
    label: content.clip.label || '',
    media: addMedia(clip.bytes, clip.type),
    poster: content.clip.poster ? addPhoto(content.clip.poster) : null,
  };

  const songs = content.songs.map((s) => ({
    title: s.title || '',
    artist: s.artist || '',
    note: s.note || '',
    embed: spotifyEmbed(s.spotify),
  }));

  const site = {
    envelopeGif: content.envelopeGif ? addMedia(...readMediaImage(content.envelopeGif)) : null,
    openingGif: content.openingGif ? prepareOpeningGif(content.openingGif, addMedia) : null,
    companionGif: content.companionGif ? addMedia(...readMediaImage(content.companionGif)) : null,
    letter: content.letter,
    clip: clipOut,
    photos,
    songs,
    reasons: content.reasons,
    voucher: content.voucher,
  };

  // 2. Bundle: [u32 header length][header JSON][media bytes...]
  let offset = 0;
  const index = {};
  for (const m of media) {
    index[m.id] = { o: offset, l: m.bytes.length, t: m.type };
    offset += m.bytes.length;
  }
  const header = Buffer.from(JSON.stringify({ v: 1, site, media: index }), 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(header.length);
  const plain = Buffer.concat([len, header, ...media.map((m) => m.bytes)]);

  // 3. Encrypt: payload.bin = "SOF1" | u32 iterations | salt(16) | iv(12) | AES-GCM ciphertext+tag
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const { subtle } = crypto.webcrypto;
  const base = await subtle.importKey('raw', Buffer.from(dateKey + '|' + secret, 'utf8'), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt'],
  );
  const cipher = Buffer.from(await subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  const prefix = Buffer.alloc(8);
  prefix.write('SOF1', 0, 'ascii');
  prefix.writeUInt32BE(ITERATIONS, 4);
  const payload = Buffer.concat([prefix, salt, iv, cipher]);

  // 4. Write dist/
  const build = crypto.createHash('sha256').update(payload).digest('hex').slice(0, 10);
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  fs.writeFileSync(path.join(DIST, 'payload.bin'), payload);
  fs.writeFileSync(path.join(DIST, '.nojekyll'), '');
  for (const file of PUBLIC_FILES) {
    let text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    if (file === 'index.html') {
      text = text
        .replace('<!--HINT-->', escapeHtml(content.hint || ''))
        .replace('data-build="dev"', `data-build="${build}"`)
        .replace(/(href|src)="(styles\.css|script\.js|date\.js)"/g, `$1="$2?v=${build}"`);
    }
    fs.writeFileSync(path.join(DIST, file), text);
  }

  // 5. Safety checks on the output
  checkNoPlaintextLeak(content);
  const samples = JSON.stringify(content).match(/SAMPLE/g) || [];
  if (samples.length) warn(`${samples.length} SAMPLE placeholders are still in private/content.js`);

  // 6. Report
  console.log(`\n✔ Built dist/  (payload ${mb(payload.length)}, ${photos.length} photos, ${songs.length} songs, ${content.reasons.length} reasons)`);
  console.log(`  Password key: ${DateKey.describe(dateKey)}`);
  for (const w of warnings) console.log('  ⚠ ' + w);
  console.log('\n  Her link ends with:  #k=' + secret);
  console.log('  Preview: npm run serve   (prints the full phone link)\n');
}

// ---------- content ----------

function loadContent() {
  const file = path.join(PRIV, 'content.js');
  if (!fs.existsSync(file)) throw new Error('private/content.js not found. Copy content.example.js to private/content.js first.');
  delete require.cache[require.resolve(file)];
  const c = require(file);
  const need = (cond, msg) => { if (!cond) throw new Error('content.js: ' + msg); };
  need(c.letter && Array.isArray(c.letter.paragraphs), 'letter.paragraphs must be a list');
  need(c.clip && ['audio', 'video'].includes(c.clip.type), "clip.type must be 'audio' or 'video'");
  need(c.clip.file, 'clip.file is missing');
  need(Array.isArray(c.photos), 'photos must be a list');
  need(Array.isArray(c.songs), 'songs must be a list');
  need(Array.isArray(c.reasons) && c.reasons.length > 0, 'reasons must be a non-empty list');
  need(c.voucher && c.voucher.title, 'voucher.title is missing');
  return c;
}

// ---------- password + link secret ----------

async function getDateKey() {
  const fromEnv = process.env.SOFIA_PASSWORD;
  const input = fromEnv || await ask('First date (day/month, e.g. 26/10): ');
  const key = DateKey.candidates(input)[0];
  if (!key) throw new Error(`Couldn't read "${input}" as a date. Use day/month, e.g. 26/10.`);
  if (!fromEnv) {
    const ok = await ask(`That's ${DateKey.describe(key)}. Correct? (y/n) `);
    if (!/^y/i.test(ok)) throw new Error('Cancelled. Run the build again.');
  }
  return key;
}

function getLinkSecret() {
  // Stable across builds so the link you send her keeps working. Delete the file to rotate it.
  if (fs.existsSync(SECRET_FILE)) {
    const s = fs.readFileSync(SECRET_FILE, 'utf8').trim();
    if (s) return s;
  }
  const s = crypto.randomBytes(16).toString('base64url');
  fs.writeFileSync(SECRET_FILE, s + '\n');
  console.log('  New link secret created in private/link-secret.txt');
  return s;
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

// ---------- media ----------

function findFfmpeg() {
  const options = [
    process.env.FFMPEG,
    'ffmpeg',
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
  ].filter(Boolean);
  for (const bin of options) {
    const r = spawnSync(bin, ['-version'], { stdio: 'ignore' });
    if (r.status === 0) return bin;
  }
  return null;
}

function preparePhoto(file, ffmpeg) {
  const src = path.join(PRIV, 'photos', file);
  if (!fs.existsSync(src)) throw new Error(`Photo not found: private/photos/${file}`);
  const ext = path.extname(file).toLowerCase();
  if (ext === '.heic' || ext === '.heif') throw new Error(`${file} is HEIC. Export it as JPG first (see README).`);
  if (!MIME[ext] || !MIME[ext].startsWith('image/')) throw new Error(`${file}: unsupported photo type ${ext}`);

  const original = fs.readFileSync(src);
  if (!ffmpeg || ext === '.svg' || ext === '.gif') return { bytes: original, type: MIME[ext] };

  // Cache resized photos so rebuilds are fast
  const stat = fs.statSync(src);
  const cacheKey = crypto.createHash('sha1').update(`${file}|${stat.size}|${stat.mtimeMs}|${PHOTO_MAX_WIDTH}`).digest('hex');
  const out = path.join(CACHE, cacheKey + '.jpg');
  if (fs.existsSync(out)) return { bytes: fs.readFileSync(out), type: 'image/jpeg' };
  fs.mkdirSync(CACHE, { recursive: true });

  // Apply the EXIF rotation ourselves so phone photos never come out sideways
  const turn = { 2: 'hflip', 3: 'hflip,vflip', 4: 'vflip', 5: 'transpose=0', 6: 'transpose=1', 7: 'transpose=3', 8: 'transpose=2' }[jpegOrientation(original)];
  const filter = [turn, `scale='min(${PHOTO_MAX_WIDTH},iw)':-2`].filter(Boolean).join(',');

  for (const q of [3, 4, 5, 6, 8, 10, 13]) {
    const r = spawnSync(ffmpeg, ['-y', '-v', 'error', '-noautorotate', '-i', src, '-vf', filter, '-q:v', String(q), '-frames:v', '1', out]);
    if (r.status !== 0) throw new Error(`ffmpeg failed on ${file}: ${r.stderr}`);
    if (fs.statSync(out).size <= PHOTO_MAX_BYTES) break;
  }
  const bytes = fs.readFileSync(out);
  if (bytes.length > PHOTO_MAX_BYTES) warn(`${file} is still ${kb(bytes.length)} after compression`);
  return { bytes, type: 'image/jpeg' };
}

// Reads the EXIF Orientation tag (1–8) from a JPEG, or 1 if there isn't one.
function jpegOrientation(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return 1;
  let i = 2;
  while (i + 4 < buf.length && buf[i] === 0xff) {
    const marker = buf[i + 1];
    const size = buf.readUInt16BE(i + 2);
    if (marker === 0xe1 && buf.toString('ascii', i + 4, i + 10) === 'Exif\0\0') {
      const t = i + 10;
      const le = buf.toString('ascii', t, t + 2) === 'II';
      const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
      const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
      const ifd = t + u32(t + 4);
      const count = u16(ifd);
      for (let e = 0; e < count; e++) {
        const entry = ifd + 2 + e * 12;
        if (u16(entry) === 0x0112) return u16(entry + 8);
      }
      return 1;
    }
    if (marker === 0xda) break; // image data starts, no EXIF found
    i += 2 + size;
  }
  return 1;
}

// An image used as-is from private/media/ (no resizing, so GIFs keep their animation)
function readMediaImage(file) {
  const src = path.join(PRIV, 'media', file);
  if (!fs.existsSync(src)) throw new Error(`Not found: private/media/${file}`);
  const type = MIME[path.extname(file).toLowerCase()];
  if (!type || !type.startsWith('image/')) throw new Error(`${file}: not a supported image type`);
  const bytes = fs.readFileSync(src);
  if (bytes.length > 2 * 1024 * 1024) warn(`${file} is ${mb(bytes.length)}, which slows down the first load`);
  return [bytes, type];
}

// The pop-up GIF plus how long one play-through lasts, so the page shows it exactly once
function prepareOpeningGif(file, addMedia) {
  const [bytes, type] = readMediaImage(file);
  if (type !== 'image/gif') throw new Error(`openingGif must be a .gif (got ${file})`);
  return { media: addMedia(bytes, type), ms: gifDurationMs(bytes) };
}

// Adds up the frame delays in a GIF's Graphic Control Extensions.
// Browsers play delays under 20ms as 100ms, so this does the same.
function gifDurationMs(buf) {
  let total = 0;
  for (let i = 0; i < buf.length - 6; i++) {
    if (buf[i] === 0x21 && buf[i + 1] === 0xf9 && buf[i + 2] === 0x04) {
      const delay = buf.readUInt16LE(i + 4) * 10;
      total += delay < 20 ? 100 : delay;
    }
  }
  return Math.min(Math.max(total, 1500), 8000);
}

function prepareClip(clip) {
  const src = path.join(PRIV, 'media', clip.file);
  if (!fs.existsSync(src)) throw new Error(`Clip not found: private/media/${clip.file}`);
  const ext = path.extname(clip.file).toLowerCase();
  const type = MIME[ext];
  if (!type || !type.startsWith(clip.type)) {
    throw new Error(`clip.type is '${clip.type}' but ${clip.file} isn't a supported ${clip.type} file. See README for the ffmpeg commands.`);
  }
  const bytes = fs.readFileSync(src);
  const limit = clip.type === 'video' ? VIDEO_MAX_BYTES : AUDIO_MAX_BYTES;
  if (bytes.length > limit) warn(`${clip.file} is ${mb(bytes.length)} (aim for under ${mb(limit)}). See README to compress it.`);
  return { bytes, type };
}

function spotifyEmbed(url) {
  if (!url) {
    warn('A song has no Spotify link yet');
    return null;
  }
  const m = String(url).match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|album|playlist|episode)\/([A-Za-z0-9]+)/);
  if (!m) {
    warn(`Not a Spotify link I can embed: ${url} (use Share → Copy Song Link)`);
    return null;
  }
  return `https://open.spotify.com/embed/${m[1]}/${m[2]}`;
}

// ---------- checks + helpers ----------

// Fails the build if any personal text ends up readable in the public files.
function checkNoPlaintextLeak(content) {
  const strings = [];
  const walk = (v, keyName) => {
    if (typeof v === 'string') {
      if (keyName !== 'hint' && keyName !== 'file' && keyName !== 'poster' && v.length >= 12) strings.push(v);
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, keyName));
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(x, k));
  };
  walk(content);
  const publicText = PUBLIC_FILES.map((f) => fs.readFileSync(path.join(DIST, f), 'utf8')).join('\n');
  const leaked = strings.filter((s) => publicText.includes(s));
  if (leaked.length) throw new Error('Personal text found in public files:\n  ' + leaked.join('\n  '));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function kb(n) { return Math.round(n / 1024) + ' KB'; }
function mb(n) { return (n / 1024 / 1024).toFixed(1) + ' MB'; }
