// TEMPLATE for private/content.js. Copy it there and fill it in. Do not put real content in this file.
// It is gitignored and gets encrypted into dist/payload.bin by `node build.js`.
// Anything marked SAMPLE is placeholder text: replace it with your own.

module.exports = {
  // Shown on the locked screen BEFORE the password, so it is public. Keep it vague.
  hint: 'SAMPLE hint — the day it all started (day and month)',

  // Shown above the closed envelope, fades away when she opens it. File in private/media/ ('' for none).
  envelopeGif: '',

  letter: {
    greeting: 'Dear Sofia,',
    paragraphs: [
      'SAMPLE — Happy birthday! I made this little page just for you, so you can open it whenever you want.',
      'SAMPLE — Write your real letter here. Each item in this list becomes its own paragraph.',
      'SAMPLE — Take your time scrolling. There are a few surprises on the way down.',
    ],
    signoff: 'Love,',
    name: 'SAMPLE — your name',
  },

  // type: 'audio' (voice note) or 'video'. File lives in private/media/.
  clip: {
    type: 'audio',
    file: 'sample-voice.wav',
    label: 'SAMPLE — A little voice note from me',
    poster: '', // video only: optional photo filename from private/photos/ shown before play
  },

  // Files live in private/photos/. Captions are optional ('' for none).
  photos: [
    { file: 'sample-1.svg', caption: 'SAMPLE — Our first trip together' },
    { file: 'sample-2.svg', caption: 'SAMPLE — That rainy afternoon' },
    { file: 'sample-3.svg', caption: '' },
    { file: 'sample-4.svg', caption: 'SAMPLE — You, laughing at my joke' },
    { file: 'sample-5.svg', caption: 'SAMPLE — Sunday breakfast' },
    { file: 'sample-6.svg', caption: 'SAMPLE — My favourite one' },
  ],

  // spotify: in Spotify tap Share → Copy Song Link and paste it here.
  songs: [
    { title: 'SAMPLE — Song title', artist: 'SAMPLE — Artist', spotify: '', note: 'SAMPLE — This was playing the first time we drove somewhere together.' },
    { title: 'SAMPLE — Song title', artist: 'SAMPLE — Artist', spotify: '', note: 'SAMPLE — You sing this one in the kitchen and it makes my day.' },
    { title: 'SAMPLE — Song title', artist: 'SAMPLE — Artist', spotify: '', note: 'SAMPLE — Every time I hear it, I think of you.' },
  ],

  reasons: [
    'SAMPLE — You always ask how my day went, and you really listen.',
    'SAMPLE — You make ordinary days feel like something to look forward to.',
    'SAMPLE — You are kind to people even when nobody is watching.',
    'SAMPLE — You make me laugh when I need it most.',
    'SAMPLE — You remember the little things I tell you.',
    'SAMPLE — You are brave about things that scare you.',
    'SAMPLE — Being around you feels like home.',
    'SAMPLE — You cheer for me on the hard days.',
    'SAMPLE — You make the best plans and the best surprises.',
  ],

  voucher: {
    kicker: 'A date with me',
    title: 'SAMPLE — Dinner at our favourite place',
    when: 'SAMPLE — Saturday 31 October, 7:30pm',
    where: 'SAMPLE — Somewhere you will love',
    note: 'SAMPLE — Wear something comfy. I will pick you up.',
  },
};
