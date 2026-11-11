# Krillion Deep Archive

All-time stats for our [Krillion](https://krillion.io) friends leaderboard.

## How it works

- **`scripts/scrape.mjs`** runs nightly at 10pm and 11pm New York time in GitHub Actions (the 10pm run is a backup in case the 11pm one is late or dropped). Krillion's day resets at midnight ET, so this gives everyone time to play. It exchanges a Firebase refresh token for an ID token, calls `https://krillion.io/api/friends` (the same API the `/friends` page uses), and merges the result into `docs/data/days/YYYY-MM-DD.json`. It then rebuilds `docs/data/all.json`.
  - Several scrapes on the same day merge together, and a score never goes back to "not played".
  - The account's profile and invite token are dropped. Only usernames, scores, and answers are saved.
- The site hides a day's answers until that day is over (midnight ET), so nobody gets spoiled. The raw JSON in the repo is still public.
- **`docs/`** is a static site served by GitHub Pages. `app.js` computes all stats in the browser from `all.json`.
- **Storage is git.** Every change is a commit, so you get full history for free.

## Setup

1. Add a repo secret called `KRILLION_REFRESH_TOKEN` (Settings → Secrets and variables → Actions).
2. Enable Pages: Settings → Pages → Deploy from branch → `main` / `/docs`.
3. Run the workflow once from the Actions tab ("Run workflow") to check that it works.

### Getting / renewing the refresh token

If the workflow starts failing with `Token refresh failed`, the token was revoked, for example because you signed out of krillion.io. To get a new one, open https://krillion.io/friends while signed in and run this in the DevTools console:

```js
(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('firebaseLocalStorageDb');q.onsuccess=()=>r(q.result)});const rows=await new Promise(r=>{const q=db.transaction('firebaseLocalStorage').objectStore('firebaseLocalStorage').getAll();q.onsuccess=()=>r(q.result)});console.log(rows.map(x=>x.value).find(v=>v?.stsTokenManager).stsTokenManager.refreshToken)})()
```

Then update the secret with: `gh secret set KRILLION_REFRESH_TOKEN`.

## Local dev

```sh
echo 'KRILLION_REFRESH_TOKEN=...' > .env   # gitignored
node scripts/scrape.mjs
python3 -m http.server -d docs 8000
```
