/* =========================================================
   Sofia's birthday site: all behaviour
   0 Helpers · 1 Decrypt · 2 Gate · 3 Envelope, letter, clip
   4 Photos · 5 Songs · 6 Reasons jar · 7 Scratch card
   8 Hearts burst · 9 Scroll reveal · 10 Start
   No personal content lives here: it all arrives in the encrypted payload.
   ========================================================= */
'use strict';

/* ---------- 0. Helpers ---------- */

// Shown on a wrong guess, in order, then repeating
const WRONG_GUESS_MESSAGES = [
  'Hmm, not quite. Try again 💭',
  'So close! Think back to our first date.',
  'Not that one, but I believe in you.',
  'Take your time. There is no rush 💗',
];

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const $ = (sel, root = document) => root.querySelector(sel);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function icon(name, className) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  if (className) svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-' + name);
  svg.appendChild(use);
  return svg;
}

// sessionStorage can throw (private mode, blocked storage): never let that break the page
const store = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } },
  remove(k) { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
};
const STORE_KEY = 'sofia-key';

// Preview-only diagnostics: on the local preview server (never on GitHub Pages),
// report what the gate is doing to the server's console so problems on a phone are visible.
const isLocalPreview = /^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
function debugLog(event, detail) {
  if (!isLocalPreview) return;
  try {
    fetch('__log', { method: 'POST', body: JSON.stringify({ event, detail, ua: navigator.userAgent }) }).catch(() => {});
  } catch { /* ignore */ }
}
window.addEventListener('error', (e) => debugLog('js-error', e.message + ' @ ' + e.filename + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => debugLog('promise-error', String(e.reason && (e.reason.stack || e.reason))));

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------- 1. Decrypt ---------- */

const linkSecret = new URLSearchParams(location.hash.slice(1)).get('k');
let payloadPromise = null;

function getPayload() {
  if (!payloadPromise) {
    const v = document.documentElement.dataset.build || 'dev';
    payloadPromise = fetch('payload.bin?v=' + v)
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .catch((err) => { payloadPromise = null; throw err; });
  }
  return payloadPromise;
}

// Returns the decrypted bytes, or null if this key is wrong
async function decrypt(buffer, dateKey) {
  const bytes = new Uint8Array(buffer);
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic !== 'SOF1') throw new Error('Unexpected payload format');
  const iterations = new DataView(buffer).getUint32(4);
  const salt = bytes.slice(8, 24);
  const iv = bytes.slice(24, 36);
  const subtle = window.crypto.subtle;
  const base = await subtle.importKey('raw', new TextEncoder().encode(dateKey + '|' + linkSecret), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
  try {
    return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv }, key, bytes.subarray(36)));
  } catch {
    return null; // AES-GCM's integrity check failed: wrong date
  }
}

// Bundle layout: [u32 header length][header JSON][media bytes]
function unpack(plain) {
  const headerLength = new DataView(plain.buffer, plain.byteOffset).getUint32(0);
  const header = JSON.parse(new TextDecoder().decode(plain.subarray(4, 4 + headerLength)));
  const start = 4 + headerLength;
  const urls = {};
  for (const [id, m] of Object.entries(header.media)) {
    const blob = new Blob([plain.subarray(start + m.o, start + m.o + m.l)], { type: m.t });
    urls[id] = URL.createObjectURL(blob);
  }
  return { site: header.site, urls };
}

/* ---------- 2. Gate ---------- */

const gate = {
  wrongCount: 0,
  busy: false,

  init() {
    if (!linkSecret) {
      $('#gate-card').hidden = true;
      $('#nolink').hidden = false;
      return;
    }
    if (!window.isSecureContext || !window.crypto || !window.crypto.subtle) {
      $('#gate-card').hidden = true;
      $('#nolink').hidden = false;
      $('#nolink-msg').textContent = 'This page needs a secure (https) link to open. Please use the link from my message.';
      return;
    }
    debugLog('gate-ready', { secure: window.isSecureContext, subtle: !!(window.crypto && window.crypto.subtle) });
    getPayload().catch(() => {}); // start downloading while she types
    $('#gate-form').addEventListener('submit', (e) => { e.preventDefault(); this.submit(); });

    const remembered = store.get(STORE_KEY);
    if (remembered) this.unlock([remembered], true);
  },

  async submit() {
    if (this.busy) return;
    const input = $('#gate-input').value;
    const keys = DateKey.candidates(input);
    debugLog('submit', { inputLength: input.length, keys });
    if (!keys.length) return this.wrong();
    await this.unlock(keys, false);
  },

  async unlock(keys, fromMemory) {
    this.busy = true;
    const btn = $('#gate-btn');
    btn.disabled = true;
    btn.textContent = 'Unlocking…';
    this.say(fromMemory ? 'Opening…' : '');
    try {
      const buffer = await getPayload();
      debugLog('payload', { bytes: buffer.byteLength });
      for (const key of keys) {
        const started = Date.now();
        const plain = await decrypt(buffer, key);
        debugLog('decrypt', { key, ok: !!plain, ms: Date.now() - started });
        if (plain) {
          store.set(STORE_KEY, key);
          this.open(unpack(plain), fromMemory);
          debugLog('unlocked');
          return;
        }
      }
      if (fromMemory) { store.remove(STORE_KEY); this.say(''); } else this.wrong();
    } catch (err) {
      console.warn(err);
      debugLog('unlock-error', String(err && (err.stack || err)));
      this.say("I couldn't load the page. Check your connection and try again."
        + (isLocalPreview ? ' (' + (err && err.message) + ')' : ''));
    } finally {
      this.busy = false;
      btn.disabled = false;
      btn.textContent = 'Unlock';
    }
  },

  wrong() {
    const card = $('#gate-card');
    this.say(WRONG_GUESS_MESSAGES[this.wrongCount % WRONG_GUESS_MESSAGES.length]);
    this.wrongCount++;
    card.classList.remove('shake');
    void card.offsetWidth; // restart the animation
    card.classList.add('shake');
    const input = $('#gate-input');
    input.select();
  },

  say(text) { $('#gate-msg').textContent = text; },

  open({ site, urls }, instant) {
    renderSite(site, urls);
    const gateEl = $('#gate');
    const finish = () => {
      gateEl.hidden = true;
      document.body.classList.replace('locked', 'unlocked');
      $('#site').hidden = false;
      window.scrollTo(0, 0);
    };
    if (instant) return finish();
    $('#gate-card').classList.add('opening');
    setTimeout(() => {
      gateEl.classList.add('leaving');
      setTimeout(finish, reduceMotion.matches ? 200 : 450);
    }, 400);
  },
};

function renderSite(site, urls) {
  envelope.init(site.letter, site.clip, urls);
  photos.render(site.photos, urls);
  songs.render(site.songs);
  jar.init(site.reasons);
  scratch.init(site.voucher);
}

/* ---------- 3. Envelope, letter, clip ---------- */

const envelope = {
  init(letter, clip, urls) {
    this.renderLetter(letter);
    player.render(clip, urls);
    const btn = $('#envelope');
    btn.addEventListener('click', () => this.open(), { once: true });
  },

  renderLetter(letter) {
    const box = $('#letter');
    box.replaceChildren();
    if (letter.greeting) box.appendChild(el('p', 'greet', letter.greeting));
    for (const text of letter.paragraphs) box.appendChild(el('p', 'para', text));
    if (letter.signoff || letter.name) {
      const sign = el('p', 'sign');
      sign.append(letter.signoff || '');
      if (letter.name) { sign.appendChild(document.createElement('br')); sign.append(letter.name); }
      box.appendChild(sign);
    }
  },

  open() {
    const btn = $('#envelope');
    btn.classList.add('open');
    btn.setAttribute('aria-label', 'Envelope, opened');
    btn.setAttribute('aria-disabled', 'true');
    const wait = reduceMotion.matches ? 150 : 950;
    setTimeout(() => {
      $('#letter').hidden = false;
      $('#clip').hidden = false;
      $('#scroll-cue').hidden = false;
      $('#rest').hidden = false;
      scratch.resize();
      reveal.watch();
      $('#letter').scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
    }, wait);
  },
};

// One player for both a voice note and a video; content.js picks which
const player = {
  render(clip, urls) {
    const box = $('#clip');
    box.replaceChildren();
    box.className = 'clip card ' + clip.type;
    const isVideo = clip.type === 'video';

    const media = document.createElement(isVideo ? 'video' : 'audio');
    media.preload = 'metadata';
    media.src = urls[clip.media];
    if (isVideo) {
      media.playsInline = true;                       // iPhone: stay inline, no forced fullscreen
      media.setAttribute('playsinline', '');
      media.setAttribute('webkit-playsinline', '');
      if (clip.poster) media.poster = urls[clip.poster];
    }

    const button = el('button', 'play-heart');
    button.type = 'button';
    button.append(icon('heart', 'heart'), icon('play', 'icon'));

    const label = el('p', 'clip-label', clip.label);
    const bar = el('div', 'clip-bar');
    const fill = el('div', 'clip-fill');
    bar.appendChild(fill);
    const time = el('p', 'clip-time', '0:00');
    const info = el('div', 'clip-info');
    info.append(label, bar, time);

    if (isVideo) {
      const frame = el('div', 'clip-video');
      frame.append(media, button);
      frame.addEventListener('click', (e) => { if (e.target === media) toggle(); });
      const row = el('div', 'clip-row');
      row.appendChild(info);
      box.append(frame, row);
    } else {
      const row = el('div', 'clip-row');
      row.append(button, info);
      box.append(row, media);
    }

    const setIcon = (playing) => {
      button.replaceChild(icon(playing ? 'pause' : 'play', 'icon'), button.lastChild);
      button.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      box.classList.toggle('playing', playing);
    };
    setIcon(false);

    function toggle() {
      if (media.paused) media.play().catch((err) => console.warn(err));
      else media.pause();
    }
    button.addEventListener('click', toggle);
    media.addEventListener('play', () => setIcon(true));
    media.addEventListener('pause', () => setIcon(false));
    media.addEventListener('ended', () => setIcon(false));

    const fmt = (s) => (Number.isFinite(s) ? Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0') : '0:00');
    const update = () => {
      const d = media.duration;
      fill.style.width = (Number.isFinite(d) && d > 0 ? (media.currentTime / d) * 100 : 0) + '%';
      time.textContent = fmt(media.currentTime) + ' / ' + fmt(d);
    };
    media.addEventListener('timeupdate', update);
    media.addEventListener('loadedmetadata', update);

    // Tap or drag on the bar to jump
    const seek = (e) => {
      const d = media.duration;
      if (!Number.isFinite(d)) return;
      const r = bar.getBoundingClientRect();
      media.currentTime = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * d;
      update();
    };
    bar.addEventListener('pointerdown', (e) => { bar.setPointerCapture(e.pointerId); seek(e); });
    bar.addEventListener('pointermove', (e) => { if (bar.hasPointerCapture(e.pointerId)) seek(e); });
  },
};

/* ---------- 4. Photos ---------- */

const photos = {
  render(list, urls) {
    const grid = $('#polaroids');
    grid.replaceChildren();
    for (const p of list) {
      const fig = el('figure', 'polaroid reveal');
      const img = el('img');
      img.src = urls[p.media];
      img.alt = p.caption || 'A photo of us';
      img.loading = 'lazy';
      img.decoding = 'async';
      fig.appendChild(img);
      if (p.caption) fig.appendChild(el('figcaption', '', p.caption));
      grid.appendChild(fig);
    }
    if (!list.length) $('#s-photos').hidden = true;
  },
};

/* ---------- 5. Songs ---------- */

const songs = {
  render(list) {
    const ul = $('#songs');
    ul.replaceChildren();
    for (const s of list) {
      const li = el('li', 'song card reveal');
      li.appendChild(el('h3', '', s.title));
      if (s.artist) li.appendChild(el('p', 'artist', s.artist));
      if (s.note) {
        const note = el('p', 'song-note', s.note);
        note.prepend(icon('heart'));
        li.appendChild(note);
      }
      if (s.embed) {
        const frame = document.createElement('iframe');
        frame.src = s.embed;
        frame.title = 'Spotify player: ' + s.title;
        frame.loading = 'lazy';
        frame.allow = 'clipboard-write; encrypted-media; fullscreen; picture-in-picture';
        li.appendChild(frame);
      } else {
        li.appendChild(el('div', 'spotify-missing', 'SAMPLE — the Spotify player appears here once you add a link'));
      }
      ul.appendChild(li);
    }
    if (!list.length) $('#s-songs').hidden = true;
  },
};

/* ---------- 6. Reasons jar ---------- */

const jar = {
  init(reasons) {
    this.reasons = reasons;
    this.deck = [];
    this.shown = 0;
    this.last = -1;
    $('#jar-count').textContent = reasons.length + ' little notes inside';
    $('#jar').addEventListener('click', () => this.pull());
  },

  // Deal from a shuffled deck so nothing repeats until every reason has been shown
  newDeck() {
    this.deck = shuffle(this.reasons.map((_, i) => i));
    const top = this.deck.length - 1;
    if (top > 0 && this.deck[top] === this.last) [this.deck[0], this.deck[top]] = [this.deck[top], this.deck[0]];
    this.shown = 0;
  },

  pull() {
    if (!this.deck.length) this.newDeck();
    const i = this.deck.pop();
    this.last = i;
    this.shown++;
    const total = this.reasons.length;

    const note = el('div', 'note', this.reasons[i]);
    note.style.setProperty('--tilt', (Math.random() * 4 - 2).toFixed(1) + 'deg');
    $('#note-stage').replaceChildren(note);

    $('#jar-count').textContent = this.shown + ' of ' + total;
    $('#jar-sub').textContent = this.shown === total
      ? "That's all of them, for now. Tap to start again 💗"
      : 'Tap again for another';

    const jarBtn = $('#jar');
    jarBtn.classList.remove('wiggle');
    void jarBtn.offsetWidth;
    jarBtn.classList.add('wiggle');
  },
};

/* ---------- 7. Scratch card ---------- */

const scratch = {
  CLEAR_AT: 0.6,     // auto-reveal once 60% is scratched
  BRUSH: 34,         // finger width in CSS pixels

  init(v) {
    const box = $('#voucher');
    box.replaceChildren();
    if (v.kicker) box.appendChild(el('p', 'v-kicker', v.kicker));
    box.appendChild(el('h3', 'v-title', v.title));
    const dl = el('dl', 'v-details');
    for (const [label, value] of [['When', v.when], ['Where', v.where]]) {
      if (!value) continue;
      const row = el('div');
      row.append(el('dt', '', label), el('dd', '', value));
      dl.appendChild(row);
    }
    box.appendChild(dl);
    if (v.note) box.appendChild(el('p', 'v-note', v.note));
    const hearts = el('div', 'v-hearts');
    hearts.append(icon('heart'), icon('heart'), icon('heart'));
    box.appendChild(hearts);

    this.canvas = $('#scratch-canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.started = false;
    this.done = false;
    this.last = null;
    this.moves = 0;

    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.down(e));
    c.addEventListener('pointermove', (e) => this.move(e));
    c.addEventListener('pointerup', () => this.up());
    c.addEventListener('pointercancel', () => this.up());
    // Belt and braces for older iOS: stop the page scrolling while scratching
    c.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    c.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

    $('#scratch-skip').addEventListener('click', () => this.clear());
    if ('ResizeObserver' in window) new ResizeObserver(() => this.resize()).observe($('#scratch'));
  },

  // Repaint the cover to match the card size (only before she starts scratching)
  async resize() {
    if (this.started || this.done || !this.canvas) return;
    const rect = $('#scratch').getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    try { await document.fonts.load('700 40px Caveat'); } catch { /* fallback font is fine */ }
    if (this.started || this.done) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.paint();
  },

  paint() {
    const { ctx, canvas } = this;
    const w = canvas.width, h = canvas.height, d = this.dpr;
    ctx.globalCompositeOperation = 'source-over';
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#E9DDFB');
    g.addColorStop(0.5, '#F8C8DC');
    g.addColorStop(1, '#FFD8BE');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // Scatter of tiny hearts and sparkles
    const heart = new Path2D('M12 20.5C7 16.6 2.5 13 2.5 8.6 2.5 5.8 4.7 3.7 7.3 3.7c1.9 0 3.6 1.1 4.7 2.8 1.1-1.7 2.8-2.8 4.7-2.8 2.6 0 4.8 2.1 4.8 4.9 0 4.4-4.5 8-9.5 11.9z');
    const spark = new Path2D('M12 2Q13 11 22 12Q13 13 12 22Q11 13 2 12Q11 11 12 2Z');
    const step = 46 * d;
    let n = 0;
    for (let y = step / 2; y < h; y += step) {
      for (let x = (n % 2 ? step : step / 2); x < w; x += step) {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(0.7 * d, 0.7 * d);
        ctx.translate(-12, -12);
        ctx.fillStyle = 'rgba(255,255,255,.55)';
        ctx.fill((x + y) % 3 < 1.5 ? heart : spark);
        ctx.restore();
      }
      n++;
    }

    // Label
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    const pw = Math.min(w * 0.8, 260 * d), ph = 70 * d;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect((w - pw) / 2, (h - ph) / 2, pw, ph, 35 * d);
    else ctx.rect((w - pw) / 2, (h - ph) / 2, pw, ph);
    ctx.fill();
    ctx.fillStyle = '#C2456E';
    ctx.font = `700 ${34 * d}px Caveat, cursive`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Scratch here ✨', w / 2, h / 2 + 2 * d);
  },

  point(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * this.dpr, y: (e.clientY - r.top) * this.dpr };
  },

  down(e) {
    if (this.done) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.started = true;
    this.last = this.point(e);
    this.stroke(this.last, this.last);
  },

  move(e) {
    if (!this.last || this.done) return;
    // Coalesced events give a smoother line on fast swipes
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (events.length ? events : [e])) {
      const p = this.point(ev);
      this.stroke(this.last, p);
      this.last = p;
    }
    if (++this.moves % 10 === 0) this.check();
  },

  up() {
    if (!this.last) return;
    this.last = null;
    this.check();
  },

  stroke(a, b) {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = this.BRUSH * this.dpr;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x + 0.01, b.y);
    ctx.stroke();
  },

  // Sample every 16th pixel's alpha to estimate how much is scratched away
  check() {
    if (this.done) return;
    const { width, height } = this.canvas;
    const data = this.ctx.getImageData(0, 0, width, height).data;
    let clear = 0, total = 0;
    for (let i = 3; i < data.length; i += 64) {
      total++;
      if (data[i] < 50) clear++;
    }
    if (total && clear / total >= this.CLEAR_AT) this.clear();
  },

  clear() {
    if (this.done) return;
    this.done = true;
    this.canvas.classList.add('cleared');
    $('#scratch-skip').style.visibility = 'hidden';
    setTimeout(() => burst($('#scratch')), reduceMotion.matches ? 0 : 250);
  },
};

/* ---------- 8. Hearts burst ---------- */

function burst(fromEl) {
  const layer = $('#burst');
  const r = fromEl.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const colors = ['#E8789A', '#F8C8DC', '#D9CBF2', '#FFD8BE', '#C94F78', '#B9A6E6'];
  const calm = reduceMotion.matches;
  const count = calm ? 10 : 32;

  for (let i = 0; i < count; i++) {
    const h = icon(i % 4 === 3 ? 'sparkle' : 'heart');
    h.style.fill = colors[i % colors.length];
    const size = 14 + Math.random() * 18;
    h.style.width = h.style.height = size + 'px';
    layer.appendChild(h);

    let frames;
    if (calm) {
      // Reduced motion: hearts simply fade in and out around the card
      const x = cx + (Math.random() - 0.5) * r.width;
      const y = cy + (Math.random() - 0.5) * r.height;
      h.style.left = x + 'px';
      h.style.top = y + 'px';
      frames = [{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }];
    } else {
      h.style.left = cx + 'px';
      h.style.top = cy + 'px';
      const angle = Math.random() * Math.PI * 2;
      const dist = 90 + Math.random() * 170;
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist - 60;
      const spin = (Math.random() - 0.5) * 120;
      frames = [
        { transform: 'translate(-50%,-50%) scale(.3)', opacity: 0 },
        { transform: `translate(calc(-50% + ${dx * 0.7}px), calc(-50% + ${dy * 0.7}px)) scale(1.1) rotate(${spin / 2}deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy + 80}px)) scale(.9) rotate(${spin}deg)`, opacity: 0 },
      ];
    }
    const anim = h.animate(frames, {
      duration: calm ? 900 : 1100 + Math.random() * 500,
      delay: Math.random() * 150,
      easing: 'cubic-bezier(.22,.9,.32,1)',
      fill: 'both',
    });
    anim.onfinish = () => h.remove();
  }
}

/* ---------- 9. Scroll reveal ---------- */

const reveal = {
  watch() {
    const items = document.querySelectorAll('.reveal:not(.in)');
    if (!('IntersectionObserver' in window)) { items.forEach((n) => n.classList.add('in')); return; }
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) { entry.target.classList.add('in'); io.unobserve(entry.target); }
      }
    }, { threshold: 0.12 });
    items.forEach((n) => io.observe(n));
  },
};

/* ---------- 10. Start ---------- */

gate.init();
