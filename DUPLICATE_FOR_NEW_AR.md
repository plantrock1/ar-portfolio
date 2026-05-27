# Duplicating for a new owner on the team

Each owner (A&R, manager, producer, …) gets their own site — own URL, own roster, own bios, own totals — while sharing this single codebase. Code updates flow to everyone automatically; you don't fork the repo.

**Per new owner you'll need:** a Neon DB, a Vercel project, 4 GitHub repo secrets, 2 GitHub Actions workflow files (already templated for `alec` / `chase` / `aidan` / `moshe` / `will`), and ~20 minutes.

Pick a short, lowercase **slug** for the new owner (matches the existing pattern: `alec`, `chase`, `aidan`, `moshe`, `will`). The slug is the join key across Vercel, GitHub Secrets, and the workflow filenames.

---

## 1. Create a new Neon database

1. [console.neon.tech](https://console.neon.tech) → **New Project**
2. Name it `ar-portfolio-<slug>`
3. Copy the **pooled** connection string (the one with `-pooler` in the hostname)

## 2. Push the schema

From your laptop:

```bash
cd "/Users/jackzuckerman/A&R Portfolio"
DATABASE_URL='<new-neon-pooled-url>' npm run db:push
```

A brand-new empty DB has no drift, so `db:push` runs cleanly with no destructive prompts. Type `y` if it asks to apply changes. All tables (including `site_settings.role_title`) are created.

## 3. Create a new Vercel project

1. [vercel.com/new](https://vercel.com/new) → import `plantrock1/ar-portfolio` (same repo)
2. Vercel will warn the project already exists — ignore. Name this one `ar-portfolio-<slug>`.
3. Framework preset: Next.js (auto).
4. **Don't deploy yet** — set env vars first.

## 4. Add Vercel environment variables

In **Settings → Environment Variables**, add these for **Production + Preview + Development**:

| Variable | Source | Notes |
|---|---|---|
| `SPOTIFY_CLIENT_ID` | shared | Same value as Alec's |
| `SPOTIFY_CLIENT_SECRET` | shared | Same value as Alec's |
| `DATABASE_URL` | per-owner | New Neon pooled URL from step 1 |
| `ADMIN_PASSWORD` | per-owner | Pick one |
| `MASTER_PASSWORD` | shared | Same value on every deployment. A recovery password that always works at login, so a locked-out owner can sign in and reset their own password. Use a long random value. |
| `SESSION_SECRET` | per-owner | `openssl rand -hex 32` — **fresh, don't reuse** |
| `CRON_SECRET` | per-owner | `openssl rand -hex 32` — **fresh, don't reuse** |
| `GITHUB_PAT` | shared | Same fine-grained PAT as other deployments (powers the "Refresh via GitHub" buttons in admin) |
| `GITHUB_AR_SLUG` | per-owner | The lowercase slug, e.g. `moshe` |

> **Lockout recovery**: if an owner forgets a password they set via the
> Change Password UI, they (or you) can sign in with `MASTER_PASSWORD` and
> reset it — no SQL needed. If `MASTER_PASSWORD` isn't set on that
> deployment, the fallback is to clear the stored hash directly:
> `UPDATE site_settings SET admin_password_hash = NULL WHERE id='main';`
> which restores the `ADMIN_PASSWORD` env var as the login.

Don't set `USE_LOCAL_CHROME` in production.

## 5. Add GitHub repo secrets

Go to https://github.com/plantrock1/ar-portfolio/settings/secrets/actions and add **4 secrets per owner** (all uppercase, suffixed with the SLUG in caps):

- `DATABASE_URL_<SLUG>` — same value as the Vercel `DATABASE_URL`
- `ADMIN_PASSWORD_<SLUG>` — same value as Vercel
- `SESSION_SECRET_<SLUG>` — same value as Vercel
- `CRON_SECRET_<SLUG>` — same value as Vercel

Example for slug `moshe`: `DATABASE_URL_MOSHE`, `ADMIN_PASSWORD_MOSHE`, `SESSION_SECRET_MOSHE`, `CRON_SECRET_MOSHE`.

The shared `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` are already in repo secrets — don't duplicate.

## 6. Add GitHub Actions workflow files

Two files per owner, in `.github/workflows/`:

- `shallow-refresh-<slug>.yml` — quick weekly monthly-listeners + top-tracks scrape (no schedule by default; admin button or manual dispatch)
- `deep-refresh-<slug>.yml` — full roster track-stream sweep, scheduled weekly Sunday at staggered UTC hours (Alec 09:00, Chase 10:00, Aidan 11:00, Moshe 12:00, Will 13:00 — pick the next free hour)

Easiest way: copy from an existing pair (e.g. `*-aidan.yml`) and find/replace `aidan`/`AIDAN`/`Aidan Rigberg` with the new slug. Bump the cron offset by 1 hour from the most recent.

## 7. Deploy

In Vercel, click **Deploy**. First build ~2 min. You'll get `ar-portfolio-<hash>-<scope>.vercel.app`.

Then **Settings → Domains** → **Add** → e.g. `moshemaleh.vercel.app` for an instant alias with TLS.

## 8. First-time admin setup (the owner does this)

They visit `https://<their-subdomain>.vercel.app/admin`, sign in with the `ADMIN_PASSWORD` you set, and:

1. **Your profile** — set:
   - **Display name** (appears in the hero + browser tab)
   - **Role title** (e.g. `A&R`, `Manager`, `Producer` — drives the "<role> Portfolio" eyebrow + browser tab suffix)
   - Bio photo, socials, bio → **Save**
2. **Spotify session** — paste their own `sp_dc` cookie from logged-in Spotify (see [SETUP_FOR_ALEC.md](SETUP_FOR_ALEC.md) for instructions)
3. **Add artist** — paste Spotify URLs for their roster (single or bulk)
4. **Refresh** — click the GitHub-triggered shallow refresh button to populate initial monthly listeners + top tracks

Done. Their site is live.

---

## How refreshes work for multiple owners

- **Shallow refresh** (monthly listeners + top tracks) — runs in GitHub Actions on demand. Triggered from the admin "Refresh" button (which dispatches `shallow-refresh-<slug>.yml` via the GitHub API using `GITHUB_PAT` + `GITHUB_AR_SLUG`).
- **Deep refresh** (full track-stream sweep) — runs in GitHub Actions on a weekly cron, plus a manual "Deep refresh" button in admin. Each owner's workflow file has its own offset hour so they don't all hit Spotify at the same minute.

Both bypass Vercel's 60s function limit by running on GitHub Actions runners (180 min budget for deep, 30 min for shallow).

---

## Rollout checklist

- [ ] Pick slug
- [ ] Neon project created, pooled URL captured
- [ ] Schema pushed via `npm run db:push`
- [ ] Vercel project imported from shared repo
- [ ] 9 Vercel env vars set (2 shared Spotify, `DATABASE_URL`, `ADMIN_PASSWORD`, `MASTER_PASSWORD`, `SESSION_SECRET`, `CRON_SECRET`, `GITHUB_PAT`, `GITHUB_AR_SLUG`)
- [ ] 4 GitHub repo secrets added (`DATABASE_URL_<SLUG>`, `ADMIN_PASSWORD_<SLUG>`, `SESSION_SECRET_<SLUG>`, `CRON_SECRET_<SLUG>`)
- [ ] 2 workflow files committed (`shallow-refresh-<slug>.yml`, `deep-refresh-<slug>.yml`)
- [ ] Deployed, subdomain claimed
- [ ] Owner given: admin URL + admin password
- [ ] Owner sets Display name + Role title + roster on first login
