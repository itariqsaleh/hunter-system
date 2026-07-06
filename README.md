# Hunter System — Step 1: PWA Shell

What's in here:
- `index.html` — Status Window, stat cards, daily quest list
- `style.css` — the dark/glow "System" look
- `app.js` — rendering + interactions
- `store.js` — data layer (localStorage now, swaps for Supabase in Step 2)
- `manifest.json` + `service-worker.js` + `icons/` — makes it installable on your iPhone

## Why you need to host it (can't just open the file)
Safari on iPhone only allows installing something as an app, and only runs
service workers, over **HTTPS**. Opening `index.html` straight from your
files won't let you "Add to Home Screen" properly or work offline.

## Fastest free way to test on your iPhone (GitHub Pages)
1. Create a free GitHub account if you don't have one.
2. Create a new repository, upload all these files (keep the folder structure).
3. Go to the repo's Settings → Pages → set source to the `main` branch, root folder.
4. Wait ~1 minute, GitHub gives you a URL like `https://yourname.github.io/repo-name/`.
5. Open that URL in Safari on your iPhone.
6. Tap the Share icon → "Add to Home Screen."
7. Open it from your Home Screen icon — it now runs full-screen like an app.

(Netlify works the same way if you'd rather drag-and-drop the folder instead
of using GitHub — either is free.)

## What's real right now
- Data is saved with `localStorage`, so it survives closing the app and
  reopening it, on this one device.
- It is **not yet** synced across devices — that's Step 2 (Supabase).

## Next step
Step 2 wires this up to Supabase so your progress survives reinstalls and
syncs across devices.
