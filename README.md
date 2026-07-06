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

## Step 2 — Supabase (done)
1. Run `supabase-schema.sql` in Supabase → SQL Editor.
2. Paste your Project URL + anon key into the top of `store.js`.
3. In Supabase → Authentication → Providers → Email, you can turn off
   "Confirm email" while testing solo, so Sign Up logs you straight in
   without needing to click a confirmation link. Turn it back on later
   if you ever open this up to other people.
4. Re-deploy (push the updated files to GitHub Pages/Netlify).
5. Open the site, Sign Up with any email/password, then Sign In.
   Your data now lives in Supabase and will follow you to any device
   you sign into.

## Step 3 — Food logging (done)
1. Run `supabase-step3.sql` in Supabase → SQL Editor. It adds macro
   targets to your profile (default 2000 kcal / 150g protein / 200g carb /
   70g fat — edit the defaults in the SQL or update your row directly if
   you want different numbers), plus the `arabic_foods` reference table
   (pre-seeded with ~20 common dishes) and your personal `food_log` table.
2. Re-deploy the updated files.
3. Tap "+ Add Food" — search the Arabic foods database and tap a result
   to auto-fill macros, or type your own food + numbers manually.
   Today's totals show as progress bars against your daily targets.

## Final step — Barcode scan + Gemini coach + macro XP + polish (done)

**1. Database**
Run `supabase-step4-final.sql` in SQL Editor (adds the `daily_bonuses` table
used to award XP once per day for hitting your protein/calorie targets).

**2. Gemini API key**
- Get a free key at https://aistudio.google.com (no card required).
- Free tier: Gemini Flash, ~10-15 requests/min, ~1,500/day — plenty for
  personal use.

**3. Deploy the Edge Function** (this is what keeps your key private)
```
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy macro-chat
supabase secrets set GEMINI_API_KEY=your_key_here
```
After deploying, your function URL is:
`https://YOUR_PROJECT_REF.functions.supabase.co/macro-chat`
Paste that into `GEMINI_PROXY_URL` at the top of `store.js`.

**4. Re-deploy** the updated `index.html`, `style.css`, `app.js`, `store.js`
to GitHub Pages/Netlify as before.

**What you get:**
- **Hunter tab** — same status window, stats, quests as before
- **Food tab** — macro bars, food log, "+ Add Food" (search or manual),
  and **Scan Barcode** (opens your camera, reads the barcode, looks it up
  on Open Food Facts, pre-fills the food form with per-100g values so you
  can adjust to your actual portion before logging)
- **Coach tab** — chat with Gemini about macros/food/workouts, routed
  through your private Edge Function so the API key never sits in the
  browser
- **Macro bonus XP** — hitting your protein target awards +20 XP once per
  day (Vitality), staying within ~85-110% of your calorie target awards
  +15 XP once per day (Discipline)
- Bottom tab bar, reduced-motion support, visible focus rings, iPhone
  safe-area padding for the notch/home indicator

**Known limits worth knowing about:**
- The barcode scanner needs camera permission and works best in good
  lighting; not every product is in Open Food Facts, especially local
  Arabic-market branded goods — that's what the manual/search entry is for.
- Coach chat history isn't saved between visits (resets on reload) —
  fine for quick questions; say the word if you want it persisted later.
- Once a day's protein/calorie bonus is awarded it won't un-award if you
  delete food afterward — simplest correct-enough behavior for personal use.

