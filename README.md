# Sofia's birthday site

A single-page birthday surprise. Everything personal is encrypted at build time, so the public
repo and the GitHub Pages site contain only code plus an unreadable `payload.bin`.

## How the privacy works

- `private/` (gitignored) holds `content.js`, `photos/`, `media/` and `link-secret.txt`.
- `node build.js` packs all of it into one bundle and encrypts it with AES-256-GCM.
  The key is PBKDF2-SHA256 (300,000 iterations, random salt) of **day+month of the first date**
  plus a **random link secret**.
- The link secret travels only in the link's `#k=…` part, which browsers never send to a server.
  Without the exact link, nobody can brute-force the 366 possible dates.
- The password is never stored. The hint (`content.hint`) is the only personal text that is public.
- A git pre-commit hook blocks commits that stage `private/` files or contain the link secret.

## Everyday commands (PowerShell)

```powershell
node build.js            # asks for the date, writes dist/
npm run serve            # preview: prints a localhost link and a phone link
```

Phone preview uses https with a self-signed certificate (the decryption API needs https).
The first time, the phone warns about the certificate: tap **Show Details → visit this website**
(iPhone) or **Advanced → Proceed** (Android). If Windows Firewall asks about Node, allow it on
**Private networks**.

## Deploying (GitHub Pages)

Live at `https://lbacus.github.io/a-little-surprise/#k=<link secret>`. Pages serves the `gh-pages`
branch, which is a copy of `dist/`. After rebuilding and committing:

```powershell
git push
git push origin "$(git subtree split --prefix dist):refs/heads/gh-pages"
```

GitHub takes about a minute to update the live site.

## Editing content

Everything is in `private/content.js`. `content.example.js` shows the format.
Rebuild after every change, then refresh the phone.

## Preparing photos

- iPhone: share the photo → **Options → Most Compatible**, or in Photos on Windows export as JPG.
  HEIC files are rejected by the build.
- Drop them in `private/photos/` and list them in `content.js`. The build resizes them to 1600px
  wide, under ~300 KB, and fixes rotation automatically (needs ffmpeg: `winget install Gyan.FFmpeg`).

## Preparing the clip

Put the result in `private/media/` and set `clip.file` and `clip.type` in `content.js`.

**Voice note → M4A (AAC, 80 kbps mono, great for voice):**

```powershell
ffmpeg -i "voice-memo.m4a" -vn -ac 1 -c:a aac -b:a 80k private/media/clip.m4a
```

**Video → MP4 (H.264, max 30 s, max 720p, plays inline on iPhone):**

```powershell
ffmpeg -i "video.mov" -t 30 -vf "scale='min(720,iw)':-2" -c:v libx264 -profile:v high -preset slow -crf 26 -pix_fmt yuv420p -c:a aac -b:a 96k -movflags +faststart private/media/clip.mp4
```

If the file is over 8 MB, run it again with `-crf 29`. To guarantee the size instead,
replace `-crf 26` with `-b:v 1900k -maxrate 2000k -bufsize 4000k` (≈ 7.5 MB for 30 s).

If an iPhone HDR video looks washed out, add tone-mapping:

```powershell
ffmpeg -i "video.mov" -t 30 -vf "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,scale='min(720,iw)':-2" -c:v libx264 -profile:v high -preset slow -crf 26 -c:a aac -b:a 96k -movflags +faststart private/media/clip.mp4
```

Optional: set `clip.poster` to a photo filename to show it before the video plays.

## Files

| File | What it does |
|---|---|
| `index.html` | Page shell and password gate. No personal content. |
| `styles.css` | All styling, one numbered block per section. |
| `script.js` | Decryption and every interaction, one block per section. |
| `date.js` | Turns any typed date into day+month. Shared by page and build. |
| `build.js` | Encrypts `private/` into `dist/`. |
| `serve.js` | Local preview server (http + https). |
| `dist/` | The deployable site. |
