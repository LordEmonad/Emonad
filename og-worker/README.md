# emonad-og — Cloudflare Worker for per-user OG cards

This Worker serves the `i.emonad.lol` subdomain. It generates a personalized
1200×630 PNG preview card for each user's referral link so when someone shares
`i.emonad.lol/<handle>` on X / Telegram / Discord, the embed shows that user's
PFP, name, level, and XP — not a generic image.

The Worker also serves a tiny HTML landing page that auto-redirects humans
through to `emonad.lol/?ref=<handle>` so the referral RPC still fires.

---

## How it works

```
User pastes      i.emonad.lol/lordemo  on X
                     ↓
X crawler hits   Worker → returns HTML with og:image pointing to
                     ↓                 i.emonad.lol/lordemo/card.png
Worker fetches   Supabase REST          (profiles row → name + avatar + xp)
                     ↓
Worker renders   PNG via workers-og     (satori under the hood)
                     ↓
Crawler embeds   the PNG in the tweet preview
Human clicks     → Worker redirects → emonad.lol/?ref=lordemo
                                       (existing referral capture fires)
```

All data is read with the public Supabase anon key — same key the website
JS uses. No service role, no secrets in the embed.

---

## One-time setup

You'll do this **once**. After that, future deploys are a single
`npm run deploy`.

### 1. Install Wrangler (Cloudflare's CLI)

You need Node 18+ on your machine.

```powershell
cd D:\code\emonad\og-worker
npm install
```

This installs `wrangler` and `workers-og` locally inside `og-worker/`.

### 2. Log into Cloudflare

```powershell
npx wrangler login
```

A browser window opens, you click "Allow" on the Cloudflare authorization
prompt. Same CF account that hosts `clerk.emonad.lol` and `api.emonad.lol`.

### 3. First deploy (creates the Worker)

```powershell
npx wrangler deploy
```

This uploads `src/index.js` and creates a Worker named `emonad-og` in your
account. The output will print a `*.workers.dev` URL — that's the Worker's
default address. **Ignore that URL** — we'll attach a real custom domain
in step 5.

### 4. Set the Supabase anon key as a secret

The Worker needs to read from Supabase. The anon key isn't a secret in the
"don't expose it" sense (it's already in the website JS), but Wrangler
stores it as an encrypted env var for clean separation.

```powershell
npx wrangler secret put SUPABASE_ANON_KEY
```

It'll prompt for the value. Paste your Supabase anon key (the one already
in `emo-profile.js` — open that file, search for `SUPABASE_ANON_KEY`,
copy the long string).

### 5. Attach the `i.emonad.lol` custom domain

This is in the **Cloudflare dashboard** (not Wrangler).

1. Open https://dash.cloudflare.com → your account → **Workers & Pages**
2. Click on `emonad-og` (the Worker you just deployed)
3. Go to **Settings → Triggers → Custom Domains**
4. Click **Add Custom Domain**
5. Enter `i.emonad.lol` and click **Add Domain**

Cloudflare will automatically:
- Create the DNS record for `i.emonad.lol`
- Provision a TLS certificate (takes ~30 seconds)
- Route all `i.emonad.lol/*` traffic to your Worker

**Important**: this only works if `emonad.lol` is on the same Cloudflare
account as a DNS zone. Per the project notes, your apex is currently
DNS-only on GitHub Pages — but the DNS zone still has to live in CF for
this to work. If `emonad.lol` isn't a zone in your CF dashboard yet, you'll
need to add it first (CF will give you nameserver instructions for your
domain registrar).

If `clerk.emonad.lol` already works as a CNAME in your CF zone, you're
already set — the zone exists, you just need to add this subdomain.

### 6. Verify

After 1–2 minutes:

```powershell
# Should return HTML with custom og:image meta tags
curl https://i.emonad.lol/lordemo

# Should return a PNG file
curl https://i.emonad.lol/lordemo/card.png -o test.png
```

Open `test.png` — should be your custom referral card.

Then test the social preview at https://www.opengraph.xyz/url/https%3A%2F%2Fi.emonad.lol%2Flordemo

---

## Subsequent deploys

Any time you change `src/index.js`:

```powershell
cd D:\code\emonad\og-worker
npx wrangler deploy
```

Takes 5 seconds. The new code is live globally on CF's edge.

## Tail logs (debugging)

If a card looks wrong or returns errors:

```powershell
npx wrangler tail
```

Shows live `console.log` / `console.error` from every request hitting
the Worker. Ctrl+C to stop.

---

## Files

- `wrangler.toml` — Worker config (name, route, compatibility flags, env vars)
- `package.json` — npm dependencies (workers-og + wrangler)
- `src/index.js` — the Worker itself (routes, Supabase fetch, card rendering)
- `README.md` — this file

## Cost

Cloudflare Workers free tier: **100,000 requests/day** + 10ms CPU per request.
Each OG card render is well under 50ms CPU. Crawlers + human clickthroughs
land under 1000 requests/day at small scale, so the free tier covers it
indefinitely.

## What to change later

- **Self-host the font**: `src/index.js` fetches Space Grotesk from Google
  Fonts on first render of each font weight. To avoid that dependency, drop
  the woff2 from `D:\code\emonad\fonts\` into a CF KV namespace and load
  from there.
- **Add total-referral / level info to the card**: Worker already fetches
  the profile row — just expand the JSX in `renderCardPng()` to display
  more stats.
- **Cache the PNG longer**: currently 1h edge cache. If users complain that
  updated XP doesn't show on their card, lower it; if you want better CDN
  performance, raise it.
