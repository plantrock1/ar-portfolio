# Duplicating for a new A&R on the team

Each A&R gets their own site (URL, roster, bios, totals) while sharing this single codebase. Code updates flow to everyone automatically — you don't fork the repo.

**Per new A&R, you'll need:** a new Neon DB, a new Vercel project, and ~15 minutes.

---

## 1. Create a new Neon database

1. [neon.tech](https://neon.tech) → **New project** (or new branch inside an existing project)
2. Name it e.g. `ar-portfolio-<their-name>`
3. Copy the **pooled** connection string (the one with `-pooler` in the hostname)

## 2. Push the schema to the new DB

You can do this from your laptop:

```bash
cd ~/Projects/ar-portfolio   # (or wherever you cloned)
# temporarily point at the new DB
DATABASE_URL="<new-neon-pooled-url>" npm run db:push
```

This creates all the tables. No data yet — the admin panel will populate.

**Alternative** (if you prefer a script): run each of these once against the new DB:

```bash
DATABASE_URL="<new-neon-pooled-url>" node scripts/migrate-settings.mjs
DATABASE_URL="<new-neon-pooled-url>" node scripts/migrate-session.mjs
DATABASE_URL="<new-neon-pooled-url>" node scripts/migrate-bios-featured.mjs
DATABASE_URL="<new-neon-pooled-url>" node scripts/migrate-site-socials.mjs
DATABASE_URL="<new-neon-pooled-url>" node scripts/migrate-bio-photo-email.mjs
DATABASE_URL="<new-neon-pooled-url>" node scripts/migrate-refresh-runs.mjs
DATABASE_URL="<new-neon-pooled-url>" node scripts/migrate-tracks-unique.mjs
DATABASE_URL="<new-neon-pooled-url>" node scripts/migrate-isrc.mjs
DATABASE_URL="<new-neon-pooled-url>" node scripts/migrate-is-primary.mjs
DATABASE_URL="<new-neon-pooled-url>" node scripts/migrate-display-name.mjs
```

(In order; each is idempotent, safe to re-run.)

## 3. Create a new Vercel project

1. [vercel.com/new](https://vercel.com/new) → import the **same** `plantrock1/ar-portfolio` repo
2. If Vercel warns "project already exists", ignore — it lets you create multiple projects from the same repo. Name this one `ar-portfolio-<their-name>`.
3. Framework preset: Next.js (auto).
4. **Don't deploy yet** — set env vars first.

## 4. Add environment variables

In the new project's **Settings → Environment Variables**, add these 6 (Production + Preview + Development for each):

| Name | Value |
|---|---|
| `SPOTIFY_CLIENT_ID` | same as Alec's |
| `SPOTIFY_CLIENT_SECRET` | same as Alec's |
| `DATABASE_URL` | the NEW Neon pooled URL from step 1 |
| `ADMIN_PASSWORD` | pick one for the new A&R |
| `SESSION_SECRET` | `openssl rand -hex 32` — **fresh, don't reuse** |
| `CRON_SECRET` | `openssl rand -hex 32` — **fresh, don't reuse** |

Don't set `USE_LOCAL_CHROME` (leave unset in production).

## 5. Deploy

Click **Deploy**. First build ~2 min. You'll get `ar-portfolio-<hash>-<scope>.vercel.app`.

## 6. Claim a nice subdomain

In the new project → **Settings → Domains** → **Add** → type e.g. `janedoe.vercel.app`. Instant TLS + alias.

## 7. First-time admin setup (the new A&R does this)

They visit `https://<their-subdomain>.vercel.app/admin`, sign in with the password you set, and:

1. In **Your profile**, set **Display name** (appears in the hero and browser tab), upload a bio photo, fill in socials, write a bio → Save
2. In **Spotify session**, paste their own `sp_dc` cookie from their logged-in Spotify (see main [SETUP_FOR_ALEC.md](SETUP_FOR_ALEC.md) section 1.5 / 3 for instructions)
3. In **Add artist**, paste Spotify URLs (single or bulk) for their roster
4. Click **Refresh** once to populate initial monthly listeners + top tracks

Done. Their site is live.

---

## About Deep Refresh for multiple A&Rs

Deep Refresh doesn't fit in Vercel Hobby's 60s function limit, so it runs either:

- **Locally** on the A&R's laptop (via their own `.env.local` + `npm run dev`). The [SETUP_FOR_ALEC.md](SETUP_FOR_ALEC.md) doc covers this — each A&R gets their own `.env.local` pointing at their own Neon DB.
- **Via GitHub Actions** on a weekly schedule. Currently the workflow is wired to a single DB (Alec's). To support multiple A&Rs, the workflow would need a matrix — one job per A&R with its own `DATABASE_URL`. Ping me if you want that built when you onboard the 2nd A&R.

For now, assume each A&R runs Deep Refresh locally when they want fresh lifetime-stream totals. Daily shallow refresh (monthly listeners + top 10) happens automatically via Vercel Cron on their own project.

---

## Rollout checklist

- [ ] Neon project created, pooled URL captured
- [ ] Schema migrated via `npm run db:push` or scripts
- [ ] New Vercel project imported from shared repo
- [ ] 6 env vars set (2 shared Spotify, 1 new DB, 3 fresh per-project)
- [ ] Deployed, subdomain claimed
- [ ] A&R given: admin URL + admin password
- [ ] A&R given: [SETUP_FOR_ALEC.md](SETUP_FOR_ALEC.md) for their own local Deep Refresh workflow (optional)
