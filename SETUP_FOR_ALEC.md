# Running Deep Refresh on your own computer

Hey Alec — this doc walks you through running **Deep Refresh** on your own laptop. You only need to do this when you want your Total Streams numbers re-calculated across your full catalog (not just your top 10 tracks). The live site at **alecveach.vercel.app** auto-updates monthly listeners daily on its own; Deep Refresh is the manual one you trigger when you want fully accurate lifetime stream totals.

Expect the one-time setup to take **~15 minutes**, and each Deep Refresh run to take **~10–20 minutes** depending on roster size.

---

## 0. Before you start

Your helper will send you **six secret values** separately — have them handy in a secure note. They look like random strings:

- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `DATABASE_URL`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`
- `CRON_SECRET`

Don't paste them into emails or chat — treat them like passwords. You'll only need them during setup; after that they're saved locally.

---

## 1. One-time setup

You only do this section **once per computer**.

### 1.1 Install Node.js and Google Chrome

If you don't already have them:

- **Google Chrome**: download from [google.com/chrome](https://www.google.com/chrome/) and install normally
- **Node.js (version 20 or higher)**: download the "LTS" installer from [nodejs.org](https://nodejs.org/) and run it. Just click through defaults.

To verify, open **Terminal** (⌘+Space → type "Terminal" → Enter) and run:

```bash
node --version
```

You should see something like `v20.x.x` or higher. If it says "command not found", the Node install didn't take — restart Terminal and try again.

### 1.2 Install Git (if you don't have it)

Run this in Terminal:

```bash
git --version
```

If you see a version number, you're good. If it prompts to install Command Line Tools, click **Install** and wait for it to finish (~5 min).

### 1.3 Download the code

Pick a folder where you want the code to live (e.g., `~/Projects`). In Terminal:

```bash
mkdir -p ~/Projects
cd ~/Projects
git clone https://github.com/plantrock1/ar-portfolio.git
cd ar-portfolio
```

The `cd ar-portfolio` step puts you *inside* the project folder. All remaining commands assume you're inside this folder. If you open a new Terminal window later, run `cd ~/Projects/ar-portfolio` first.

### 1.4 Install the project's dependencies

Still inside the `ar-portfolio` folder:

```bash
npm install
```

This downloads all the packages the project needs. Takes ~1–2 minutes. You'll see some warnings about "deprecated" packages — safe to ignore.

### 1.5 Create your environment file

This file stores your secrets locally. It's automatically gitignored, so it won't get uploaded anywhere.

In Terminal, inside the `ar-portfolio` folder:

```bash
touch .env.local
open -e .env.local
```

TextEdit will open with an empty file. Paste this in, replacing each `<...>` with the value your helper sent you:

```
SPOTIFY_CLIENT_ID=<paste-id-here>
SPOTIFY_CLIENT_SECRET=<paste-secret-here>
DATABASE_URL=<paste-database-url-here>
ADMIN_PASSWORD=welcometomusic
SESSION_SECRET=<paste-session-secret-here>
CRON_SECRET=<paste-cron-secret-here>
USE_LOCAL_CHROME=1
```

**Important notes:**

- `ADMIN_PASSWORD` should be `welcometomusic` unless your helper told you otherwise
- `USE_LOCAL_CHROME=1` must be exactly that (with the `=1`) — it tells the scraper to use your normal Chrome installation instead of a bundled one
- Each line must have **no spaces** around the `=` sign
- Save the file (⌘+S) and close it

---

## 2. Running Deep Refresh

Do this any time you want your Total Streams numbers updated across the full catalog.

### 2.1 Start the local server

In Terminal, inside the `ar-portfolio` folder:

```bash
npm run dev
```

After 1–2 seconds you'll see:

```
✓ Ready in 461ms
- Local: http://localhost:3000
```

**Leave this terminal window open.** Closing it shuts down the server. If the terminal gets in the way, just move the window aside.

### 2.2 Open the admin page

In any browser, go to:

```
http://localhost:3000/admin
```

Sign in with the admin password (`welcometomusic` unless it was changed). You'll see the same admin dashboard as the live site — but this one is running on your laptop and can handle long tasks.

### 2.3 Close your own Spotify tabs

Before clicking Deep Refresh, **close any Spotify tabs in your browser** (open.spotify.com, web player, anything). Spotify has a "too many tabs" limit per account, and the scraper uses the same session as you — if you've got Spotify open while the scraper is running, some pages fail to load. You can reopen Spotify once the refresh is done.

### 2.4 Click Deep Refresh

On the admin page, find the green **Deep refresh** button at the bottom of the "Add artist" section. Click it.

You'll see a progress bar that moves through four phases:

1. **Verifying session** — checks your stored Spotify cookie is still valid (~1 sec)
2. **Discovery** — lists every album on Spotify (~10 sec)
3. **Albums** — scrapes each album for track names and IDs (~5 min for ~100 albums)
4. **Tracks** — visits each individual track page for stream counts (~5–10 min for ~200 tracks)

**Total time: ~10–20 minutes** for a typical roster. You can close the browser tab during the refresh — the server keeps running in your terminal window, and the DB gets updated regardless. Just don't close the terminal window.

When it finishes, you'll see a completion message like `Deep refresh complete · 3 artists · 97 albums · 205 tracks · 873s`.

### 2.5 Stop the local server

When you're done, go back to the terminal window and press **Ctrl+C** (yes, Ctrl — not Cmd — even on Mac). The server shuts down. You can close the terminal window now.

Your live site at **alecveach.vercel.app** automatically shows the updated numbers — the local scraper writes to the same shared database.

---

## 3. Updating your Spotify session (every ~12 months)

The Spotify cookie stored in the DB expires after about a year, or whenever you "Sign out everywhere" in your Spotify account. When it expires, Deep Refresh will fail immediately with "Spotify session expired — re-import sp_dc cookie in /admin".

To refresh it:

1. In Chrome, log into [open.spotify.com](https://open.spotify.com) normally
2. Open **DevTools**: View menu → Developer → Developer Tools (or ⌥⌘I)
3. Click the **Application** tab at the top
4. In the left sidebar, expand **Cookies** → click `https://open.spotify.com`
5. Find the row where Name is **`sp_dc`**
6. Click that row. The **Value** (long string of letters and numbers) appears — select all of it and copy
7. Go to the local admin at `http://localhost:3000/admin` (start the server first if needed)
8. Scroll to the "Spotify session" section → paste into the password field → **Save cookie**

You can also do this from the live site (`alecveach.vercel.app/admin`) — the saved cookie works both places because they share the database.

---

## 4. Troubleshooting

**"port 3000 is already in use"** when running `npm run dev`:
Another process is on port 3000. Run `lsof -i:3000` to see what, then `kill <that-PID>`. Or just restart your computer.

**Deep Refresh stops after a few seconds with "Spotify session expired"**:
Your cookie lapsed. Follow section 3 above.

**Deep Refresh gets to "albums" phase then stalls**:
You probably have Spotify open in another tab. Close all open.spotify.com tabs and click Deep Refresh again.

**"Failed to fetch" errors in the browser console**:
The local server stopped. Check your terminal window — if it's closed or shows an error, go back to section 2.1 and start it again.

**Can't find where the terminal command went**:
You probably closed the terminal window or the `cd` command didn't work. Start fresh:
```bash
cd ~/Projects/ar-portfolio
npm run dev
```

**Changes I make locally don't show on the live site**:
Make sure you actually clicked Deep Refresh (or Refresh for shallow). Also refresh the browser tab at alecveach.vercel.app. Data writes to the shared DB but pages cache for up to a minute.

**Admin page says "Invalid password"**:
Double-check `.env.local` — the `ADMIN_PASSWORD=` line should match what you're typing exactly, no trailing spaces. If in doubt, change it to a new simple string, save the file, stop the server (Ctrl+C), and restart (`npm run dev`).

---

## Quick cheat sheet

Daily/weekly use (after first-time setup):

```bash
cd ~/Projects/ar-portfolio      # get into the folder
npm run dev                      # start the server
# open http://localhost:3000/admin in a browser
# close Spotify tabs, click "Deep refresh", wait
# when done: Ctrl+C in terminal to stop
```

That's it. Questions? Ping your helper.
