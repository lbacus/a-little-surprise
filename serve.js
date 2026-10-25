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
    console.log('\n(Phone shows a certificate warning the first time: tap Show Details → visit this website.)\n');
  });
} else {
  console.log('Could not create an https certificate (openssl not found), so phone preview is unavailable.');
}
