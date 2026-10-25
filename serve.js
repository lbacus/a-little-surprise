#!/usr/bin/env node
// Local preview server for dist/ (no dependencies). Listens on every network interface (0.0.0.0).
//   http://localhost:8080   for this computer
//   https://<your-ip>:8443  for your phone on the same Wi-Fi
// The phone needs https: browsers only allow the decryption API on secure pages.
// The certificate is self-signed (made with the openssl that ships with Git), so the phone
// shows a one-time warning you can tap through.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawnSync } = require('child_process');

const DIST = path.join(__dirname, 'dist');
const CERT_DIR = path.join(__dirname, 'private', '.cert');
const HTTP_PORT = Number(process.env.PORT) || 8080;
const HTTPS_PORT = HTTP_PORT + 363;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.bin': 'application/octet-stream',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function handler(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const who = req.socket.remoteAddress.replace('::ffff:', '');

  // Diagnostics sent by script.js while previewing (see debugLog there)
  if (req.method === 'POST' && urlPath === '/__log') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; if (body.length > 10000) req.destroy(); });
    req.on('end', () => {
      console.log(`[page ${who}] ${body}`);
      res.writeHead(204);
      res.end();
    });
    return;
  }

  // Phone photo upload (preview only): /upload?k=<link secret> saves straight into private/photos
  if (urlPath === '/upload') return upload(req, res, who);

  const file = path.normalize(path.join(DIST, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(DIST + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    console.log(`[${who}] ${req.method} ${urlPath} 404`);
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  console.log(`[${who}] ${req.method} ${urlPath} 200`);
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(file).pipe(res);
}

const PHOTOS = path.join(__dirname, 'private', 'photos');
const MAX_UPLOAD = 40 * 1024 * 1024;
const PHOTO_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'];

function upload(req, res, who) {
  const k = new URL(req.url, 'http://x').searchParams.get('k');
  if (!secret || k !== secret) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(UPLOAD_PAGE);
  }
  if (req.method !== 'POST') { res.writeHead(405); return res.end(); }

  // One file per request, raw body; the original name comes in a header
  let name = 'photo.jpg';
  try { name = decodeURIComponent(String(req.headers['x-filename'] || name)); } catch { /* keep default */ }
  let safe = path.basename(name).replace(/[^\w.-]/g, '_');
  const ext = path.extname(safe).toLowerCase();
  if (!PHOTO_EXT.includes(ext)) { res.writeHead(415); return res.end('Only photos, please'); }
  // iPhones often name every upload "image.jpg", so never overwrite: add -1, -2, ...
  const base = safe.slice(0, -ext.length);
  for (let i = 1; fs.existsSync(path.join(PHOTOS, safe)); i++) safe = `${base}-${i}${ext}`;

  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_UPLOAD) { res.writeHead(413); res.end('Too big'); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => {
    if (size > MAX_UPLOAD) return;
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, safe), Buffer.concat(chunks));
    console.log(`[upload ${who}] saved private/photos/${safe} (${Math.round(size / 1024)} KB)`);
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(safe);
  });
}

const UPLOAD_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Upload photos</title>
<style>
  body { margin: 0; padding: 24px 16px; font: 17px/1.5 system-ui, sans-serif; background: #FFF8F0; color: #5A3E4B; }
  h1 { margin: 0 0 6px; color: #C2456E; font-size: 26px; }
  p { margin: 0 0 18px; }
  label { display: block; padding: 18px; border: 2px dashed #E8789A; border-radius: 18px; text-align: center; background: #fff; font-weight: 700; color: #C2456E; }
  input { display: none; }
  ul { list-style: none; padding: 0; margin: 18px 0 0; }
  li { padding: 10px 14px; margin-bottom: 8px; background: #fff; border-radius: 12px; word-break: break-all; }
  .ok { color: #2e7d32; } .err { color: #c62828; }
</style></head><body>
<h1>Upload photos 📷</h1>
<p>Pick the photos for Sofia's page. They go straight to your PC (private/photos), never online.</p>
<label>Choose photos<input id="f" type="file" accept="image/*" multiple></label>
<ul id="list"></ul>
<script>
  document.getElementById('f').addEventListener('change', async (e) => {
    const list = document.getElementById('list');
    for (const file of e.target.files) {
      const li = document.createElement('li');
      li.textContent = 'Uploading ' + file.name + '…';
      list.appendChild(li);
      try {
        const r = await fetch(location.pathname + location.search, {
          method: 'POST', headers: { 'X-Filename': encodeURIComponent(file.name) }, body: file,
        });
        if (!r.ok) throw new Error(await r.text());
        li.textContent = '✓ Saved as ' + await r.text();
        li.className = 'ok';
      } catch (err) {
        li.textContent = '✗ ' + file.name + ': ' + err.message;
        li.className = 'err';
      }
    }
    e.target.value = '';
  });
</script></body></html>`;

function ensureCert() {
  const key = path.join(CERT_DIR, 'key.pem');
  const cert = path.join(CERT_DIR, 'cert.pem');
  if (fs.existsSync(key) && fs.existsSync(cert)) return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
  fs.mkdirSync(CERT_DIR, { recursive: true });
  const candidates = [process.env.OPENSSL, 'openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe'].filter(Boolean);
  for (const bin of candidates) {
    const r = spawnSync(bin, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '60',
      '-keyout', key, '-out', cert, '-subj', '/CN=sofia-preview'], { stdio: 'ignore' });
    if (r.status === 0) return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
  }
  return null;
}

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254'))
    .map((a) => a.address);
}

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('dist/ is empty. Run: node build.js');
  process.exit(1);
}

let secret = '';
try { secret = fs.readFileSync(path.join(__dirname, 'private', 'link-secret.txt'), 'utf8').trim(); } catch { /* none yet */ }
const hash = secret ? '/#k=' + secret : '/';

http.createServer(handler).listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`\nThis computer:  http://localhost:${HTTP_PORT}${hash}`);
});

const tls = ensureCert();
if (tls) {
  https.createServer(tls, handler).listen(HTTPS_PORT, '0.0.0.0', () => {
    for (const ip of lanAddresses()) console.log(`Your phone:     https://${ip}:${HTTPS_PORT}${hash}`);
    if (secret) for (const ip of lanAddresses()) console.log(`Upload photos:  https://${ip}:${HTTPS_PORT}/upload?k=${secret}`);
    console.log('\n(Phone shows a certificate warning the first time: tap Show Details → visit this website.)\n');
  });
} else {
  console.log('Could not create an https certificate (openssl not found), so phone preview is unavailable.');
}
