// Turns whatever date Sofia types into candidate "DDMM" keys.
// Shared by the browser (script.js) and the build (build.js), so both always agree.
//
// The input is reduced to digits, then read as day+month (any year is ignored).
// "26/10", "26-10-2025", "26.10.25", "2610", "5/3", "2025-10-26", "26 Oct" all work.
// If day-first doesn't fit, month-first (US style, "10/26") is tried as well.
(function (root) {
  'use strict';

  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  const MAX_CANDIDATES = 4; // each guess costs one key derivation (~0.3–0.8s on a phone)

  const pad = (n) => String(n).padStart(2, '0');
  const isValid = (d, m) => m >= 1 && m <= 12 && d >= 1 && d <= DAYS_IN_MONTH[m - 1];

  function candidates(input) {
    const text = String(input || '').toLowerCase();
    const digits = text.replace(/\D/g, '');
    const out = [];
    const add = (d, m) => {
      d = Number(d); m = Number(m);
      if (!isValid(d, m)) return;
      const key = pad(d) + pad(m);
      if (!out.includes(key)) out.push(key);
    };
    if (!digits) return out;

    // A month written as a word: "26 Oct", "October 26th"
    const words = text.match(/[a-z]{3,}/g) || [];
    const monthIndex = words.map((w) => MONTHS.indexOf(w.slice(0, 3))).find((i) => i >= 0);
    if (monthIndex !== undefined) {
      add(digits.slice(0, 2), monthIndex + 1);
      add(digits.slice(0, 1), monthIndex + 1);
      return out.slice(0, MAX_CANDIDATES);
    }

    // Digits only. Leftover digits after day+month must look like a year (0, 2 or 4 digits).
    const n = digits.length;
    const splits = [[2, 2], [1, 2], [2, 1], [1, 1]];
    const fits = (a, b) => a + b <= n && [0, 2, 4].includes(n - a - b);

    for (const [dl, ml] of splits) {
      if (fits(dl, ml)) add(digits.slice(0, dl), digits.slice(dl, dl + ml));
    }
    // Year first: 2025-10-26
    if (n === 8 && /^(19|20)/.test(digits)) add(digits.slice(6, 8), digits.slice(4, 6));
    // Month first: 10/26
    for (const [ml, dl] of splits) {
      if (fits(ml, dl)) add(digits.slice(ml, ml + dl), digits.slice(0, ml));
    }
    return out.slice(0, MAX_CANDIDATES);
  }

  function describe(key) {
    return Number(key.slice(0, 2)) + ' ' + MONTH_NAMES[Number(key.slice(2, 4)) - 1];
  }

  const api = { candidates, describe };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DateKey = api;
})(this);
