# A&R Portfolio — Alec Veach

Public portfolio site showcasing artists and songs signed by Alec Veach, with live Spotify metrics (followers, monthly listeners, popularity) pulled daily and aggregated across the roster.

## Stack

- **Next.js 16** (App Router) + React 19 + TypeScript + Tailwind
- **Neon Postgres** (serverless) + Drizzle ORM
- **Spotify Web API** (Client Credentials) for metadata, followers, popularity
- **Headless Chromium** (puppeteer-core + @sparticuz/chromium) scrapes monthly listeners once a day
- **Recharts** for growth charts
- Deployed on **Vercel** with a daily Cron job

## One-time setup

### 1. Create a Neon database (free)

1. Sign up at [neon.tech](https://neon.tech)
2. Create a new project named `ar-portfolio`
3. Copy the pooled `DATABASE_URL` from the dashboard
4. Paste it into `.env.local` as `DATABASE_URL=...`

### 2. Spotify credentials

Already in `.env.local` — but **rotate the secret** at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) since it was pasted into a chat transcript.

### 3. Push schema & seed

```bash
npm run db:push        # creates tables in Neon
npm run dev            # localhost:3000
```

### 4. Add artists

Visit `/admin`, enter your `ADMIN_PASSWORD`, and paste Spotify artist URLs like `https://open.spotify.com/artist/4gzpq5DPGxSnKTe4SA8HAU`.

Hit "Refresh now" once to populate initial data (monthly listeners will take ~10s to scrape).

## Deploy to Vercel

1. `git init && git add . && git commit -m "initial"`
2. Create a new GitHub repo, push
3. Import the repo at [vercel.com/new](https://vercel.com/new)
4. Add **all** env vars from `.env.example` to Vercel's Environment Variables (use the same values from `.env.local` except generate a fresh `SESSION_SECRET` and `CRON_SECRET` with `openssl rand -hex 32`)
5. Deploy

Vercel Cron will auto-run `/api/cron/refresh` daily at 09:00 UTC (configurable in `vercel.json`).

## Shareable link

After deploy: `https://<your-project>.vercel.app`. Attach a custom domain in Vercel's dashboard if desired.
