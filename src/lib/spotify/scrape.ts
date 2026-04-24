import type { Browser, Page } from "puppeteer-core";

const LOCAL_CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
];

async function localChromePath(): Promise<string | null> {
  const fs = await import("node:fs/promises");
  for (const p of LOCAL_CHROME_PATHS) {
    try {
      await fs.access(p);
      return p;
    } catch {
      // keep searching
    }
  }
  return null;
}

const STEALTH_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--disable-features=IsolateOrigins,site-per-process",
];

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

export async function launchBrowser(): Promise<Browser> {
  const useLocal = process.env.USE_LOCAL_CHROME === "1";
  const puppeteer = await import("puppeteer-core");

  if (useLocal) {
    const executablePath = await localChromePath();
    if (!executablePath) {
      throw new Error(
        "USE_LOCAL_CHROME=1 but no Chrome/Chromium found on this machine",
      );
    }
    return puppeteer.default.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", ...STEALTH_ARGS],
    });
  }

  const chromium = (await import("@sparticuz/chromium")).default as unknown as {
    args: string[];
    defaultViewport?: { width: number; height: number; deviceScaleFactor?: number };
    executablePath: () => Promise<string>;
  };
  return puppeteer.default.launch({
    args: [...chromium.args, ...STEALTH_ARGS],
    defaultViewport: chromium.defaultViewport ?? { width: 1366, height: 800 },
    executablePath: await chromium.executablePath(),
    headless: true,
  });
}

async function applyStealth(page: Page) {
  await page.evaluateOnNewDocument(() => {
    // esbuild (used by tsx) wraps transformed function expressions with a
    // `__name()` helper for preserving function names in stack traces. When
    // those wrapped functions are serialized into page.evaluate(), they run
    // in the browser context which doesn't define __name. Shim it here so
    // every evaluated function can call through.
    // @ts-expect-error shim on window
    if (typeof globalThis.__name === "undefined") {
      // @ts-expect-error shim on window
      globalThis.__name = (fn) => fn;
    }
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3, 4, 5].map(() => ({})),
    });
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en"],
    });
    // @ts-expect-error runtime global
    window.chrome = { runtime: {} };
    const origQuery = window.navigator.permissions?.query;
    if (origQuery) {
      window.navigator.permissions.query = (p: PermissionDescriptor) =>
        p.name === "notifications"
          ? Promise.resolve({
              state: Notification.permission,
            } as PermissionStatus)
          : origQuery.call(window.navigator.permissions, p);
    }
  });
}

async function setupPage(page: Page, spDc?: string | null) {
  await applyStealth(page);
  await page.setUserAgent(USER_AGENT);
  await page.setViewport({ width: 1366, height: 800 });
  await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
  if (spDc) {
    await page.setCookie({
      name: "sp_dc",
      value: spDc,
      domain: ".spotify.com",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "None",
    });
  }
}

async function dismissCookieBanner(page: Page) {
  await page
    .evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const accept = btns.find((b) =>
        /accept|agree|ok/i.test(b.textContent ?? ""),
      );
      if (accept) (accept as HTMLButtonElement).click();
    })
    .catch(() => {});
}

function parseCount(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/[,\.\s]/g, "");
  const mMatch = raw.trim().match(/^([\d.]+)\s*([KMB])$/i);
  if (mMatch) {
    const n = parseFloat(mMatch[1]);
    const mult =
      mMatch[2].toUpperCase() === "B"
        ? 1e9
        : mMatch[2].toUpperCase() === "M"
          ? 1e6
          : 1e3;
    return Math.round(n * mult);
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// ============================================================================
// Types
// ============================================================================

export type ScrapedTrack = {
  spotifyId: string;
  name: string;
  streams: number | null;
  albumImageUrl: string | null;
  /** true when the target artist is the first-credited (primary) on this track */
  isPrimary?: boolean;
};

export type ScrapedArtistPage = {
  spotifyId: string;
  monthlyListeners: number | null;
  tracks: ScrapedTrack[];
  albumIds: string[];
  error?: string;
};

export type ScrapedAlbum = {
  spotifyId: string;
  tracks: ScrapedTrack[];
  error?: string;
};

export type DeepScrapedArtist = {
  spotifyId: string;
  monthlyListeners: number | null;
  tracks: ScrapedTrack[]; // deduped union of artist page + all album tracks
  albumCount: number;
  error?: string;
};

export type SessionCheck = { authenticated: boolean; error?: string };

// ============================================================================
// Session check — verify a cookie is valid
// ============================================================================

export async function checkSession(spDc: string): Promise<SessionCheck> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await setupPage(page, spDc);
    await page.goto("https://open.spotify.com/", {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    await new Promise((r) => setTimeout(r, 1500));
    const authenticated = await page.evaluate(() => {
      // Logged-in pages do NOT have a prominent "Log in" button in the header
      // but DO have user-menu or library links.
      const text = document.body.innerText;
      const hasLogin = /Log in|Sign up free/i.test(text);
      const hasLibrary = /Your Library/i.test(text);
      return hasLibrary && !hasLogin;
    });
    await page.close().catch(() => {});
    return { authenticated };
  } catch (e) {
    return {
      authenticated: false,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

// ============================================================================
// Artist page scrape — monthly listeners + top tracks + album IDs
// ============================================================================

export async function scrapeArtistPages(
  spotifyIds: string[],
  opts: {
    spDc?: string | null;
    concurrency?: number;
    /**
     * Skip the discography scroll + album-link collection. Shallow refresh
     * only needs monthly listeners + top-5 tracks (both rendered in the
     * first viewport); skipping the bottom-of-page work saves ~3s per
     * artist and keeps us well inside Vercel's 60s function budget.
     */
    skipAlbums?: boolean;
    /** Called after each artist finishes; useful for live progress. */
    onOne?: (
      done: number,
      total: number,
      result: ScrapedArtistPage,
    ) => Promise<void> | void;
  } = {},
): Promise<ScrapedArtistPage[]> {
  if (spotifyIds.length === 0) return [];
  const concurrency = opts.concurrency ?? 3;
  const browser = await launchBrowser();
  try {
    const results: ScrapedArtistPage[] = [];
    const queue = [...spotifyIds];
    const total = spotifyIds.length;
    let done = 0;
    async function worker() {
      while (queue.length) {
        const id = queue.shift();
        if (!id) return;
        const page = await browser.newPage();
        let result: ScrapedArtistPage;
        try {
          await setupPage(page, opts.spDc);
          result = await scrapeArtistPage(page, id, opts.skipAlbums);
        } finally {
          await page.close().catch(() => {});
        }
        results.push(result);
        done += 1;
        if (opts.onOne) {
          try {
            await opts.onOne(done, total, result);
          } catch {
            // progress reporting must never break the scrape
          }
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(concurrency, spotifyIds.length) }, () =>
        worker(),
      ),
    );
    return results;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function scrapeArtistPage(
  page: Page,
  spotifyId: string,
  skipAlbums = false,
): Promise<ScrapedArtistPage> {
  try {
    await page.goto(`https://open.spotify.com/artist/${spotifyId}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await dismissCookieBanner(page);

    // Wait for the actual data we're extracting: the "X monthly listeners"
    // text in the body. 8s is plenty — if it's not there by then, the page
    // is struggling and more waiting won't help.
    await page
      .waitForFunction(
        () => /[\d,\.]+\s+monthly listeners/i.test(document.body.innerText),
        { timeout: 8_000 },
      )
      .catch(() => null);

    if (skipAlbums) {
      // Fast path: monthly listeners + top-5 tracks are in the hero; no
      // need to scroll for album links.
      await page.evaluate(() => window.scrollTo(0, 400)).catch(() => {});
      await new Promise((r) => setTimeout(r, 600));
    } else {
      // Deep path: scroll to bottom to let the discography hydrate with
      // lazy-loaded album tiles, then come back up.
      await page
        .evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        .catch(() => {});
      await new Promise((r) => setTimeout(r, 2500));
      await page.evaluate(() => window.scrollTo(0, 400)).catch(() => {});
      await new Promise((r) => setTimeout(r, 1000));
    }

    const data = await page.evaluate(() => {
      const body = document.body.innerText;
      const mlMatch = body.match(/([\d,\.]+)\s+monthly listeners/i);
      const monthlyListenersText = mlMatch ? mlMatch[1] : null;

      function biggestNumber(text: string): string | null {
        const cleaned = text.replace(/\d+:\d+/g, " ");
        const matches = cleaned.match(/\d{1,3}(?:,\d{3})+|\d{5,}/g);
        if (!matches || matches.length === 0) return null;
        let best: string | null = null;
        let bestN = -1;
        for (const m of matches) {
          const n = Number(m.replace(/,/g, ""));
          if (n > bestN) {
            bestN = n;
            best = m;
          }
        }
        return best;
      }

      // Top tracks from the "Popular" tracklist
      const rows = Array.from(
        document.querySelectorAll('[data-testid^="tracklist-row"]'),
      ) as HTMLElement[];
      const seen = new Set<string>();
      const tracks: {
        spotifyId: string;
        name: string;
        streams: string | null;
        albumImageUrl: string | null;
        primaryArtistId: string | null;
      }[] = [];
      for (const row of rows) {
        const anchor = row.querySelector(
          'a[href*="/track/"]',
        ) as HTMLAnchorElement | null;
        if (!anchor) continue;
        const m = anchor.href.match(/\/track\/([a-zA-Z0-9]{22})/);
        if (!m) continue;
        const id = m[1];
        if (seen.has(id)) continue;
        const name = (anchor.textContent ?? "").trim();
        if (!name) continue;
        const rowText = row.innerText ?? "";
        const withoutName = name ? rowText.split(name).join(" ") : rowText;
        const streamsText = biggestNumber(withoutName);
        const img = row.querySelector("img") as HTMLImageElement | null;
        const firstArtist = row.querySelector(
          'a[href*="/artist/"]',
        ) as HTMLAnchorElement | null;
        const primaryArtistId =
          firstArtist?.href.match(/\/artist\/([a-zA-Z0-9]{22})/)?.[1] ?? null;
        tracks.push({
          spotifyId: id,
          name,
          streams: streamsText,
          albumImageUrl: img?.src ?? null,
          primaryArtistId,
        });
        seen.add(id);
        if (tracks.length >= 10) break;
      }

      // Album IDs — every /album/{id} anchor on the page
      const albumIds = new Set<string>();
      for (const a of Array.from(
        document.querySelectorAll('a[href*="/album/"]'),
      )) {
        const m = (a as HTMLAnchorElement).href.match(
          /\/album\/([a-zA-Z0-9]{22})/,
        );
        if (m) albumIds.add(m[1]);
      }

      return {
        monthlyListenersText,
        tracks,
        albumIds: Array.from(albumIds),
      };
    });

    // Diagnostic: if we didn't find the monthly listeners string, log what
    // the page actually showed so we can tell if it's an interstitial, a
    // geo-check, a challenge page, etc.
    if (!data.monthlyListenersText) {
      const diag = await page.evaluate(() => ({
        url: location.href,
        title: document.title,
        snippet: (document.body.innerText ?? "")
          .slice(0, 600)
          .replace(/\n/g, " | "),
      }));
      console.warn(
        `[scrape] no monthly listeners for ${spotifyId} — title="${diag.title}" url="${diag.url}"\n  body: ${diag.snippet}`,
      );
    }

    return {
      spotifyId,
      monthlyListeners: parseCount(data.monthlyListenersText),
      tracks: data.tracks.map((t) => ({
        spotifyId: t.spotifyId,
        name: t.name,
        streams: parseCount(t.streams),
        albumImageUrl: t.albumImageUrl,
        isPrimary: t.primaryArtistId ? t.primaryArtistId === spotifyId : undefined,
      })),
      albumIds: data.albumIds,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[scrape] artist page failed for ${spotifyId}: ${msg}`);
    return {
      spotifyId,
      monthlyListeners: null,
      tracks: [],
      albumIds: [],
      error: msg,
    };
  }
}

// ============================================================================
// Album page scrape — all tracks with play counts (needs auth cookie)
// ============================================================================

export async function scrapeAlbumsAuthed(
  albumIds: string[],
  opts: {
    spDc: string;
    concurrency?: number;
    browser?: Browser;
    /**
     * If set, keep only tracks whose row contains an `<a href="/artist/{id}">`
     * link matching this Spotify artist ID. Reliable across collabs, aliases,
     * and unicode-bearing names.
     */
    filterArtistSpotifyId?: string;
  } = { spDc: "" },
): Promise<ScrapedAlbum[]> {
  if (albumIds.length === 0) return [];
  if (!opts.spDc) throw new Error("scrapeAlbumsAuthed requires a sp_dc cookie");
  const concurrency = opts.concurrency ?? 4;
  const browser = opts.browser ?? (await launchBrowser());
  const ownsBrowser = !opts.browser;
  try {
    const results: ScrapedAlbum[] = [];
    const queue = [...albumIds];
    async function worker() {
      while (queue.length) {
        const id = queue.shift();
        if (!id) return;
        const page = await browser.newPage();
        try {
          await setupPage(page, opts.spDc);
          results.push(
            await scrapeAlbumPage(page, id, opts.filterArtistSpotifyId),
          );
        } finally {
          await page.close().catch(() => {});
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(concurrency, albumIds.length) }, () =>
        worker(),
      ),
    );
    return results;
  } finally {
    if (ownsBrowser) await browser.close().catch(() => {});
  }
}

async function scrapeAlbumPage(
  page: Page,
  albumId: string,
  filterArtistSpotifyId?: string,
): Promise<ScrapedAlbum> {
  try {
    await page.goto(`https://open.spotify.com/album/${albumId}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page
      .waitForSelector('[data-testid^="tracklist-row"]', { timeout: 15_000 })
      .catch(() => null);
    await dismissCookieBanner(page);
    await page.evaluate(() => window.scrollTo(0, 400)).catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));

    const data = await page.evaluate((filterArtistId: string | null) => {
      function biggestNumber(text: string): string | null {
        const cleaned = text.replace(/\d+:\d+/g, " ");
        const matches = cleaned.match(/\d{1,3}(?:,\d{3})+|\d{5,}/g);
        if (!matches || matches.length === 0) return null;
        let best: string | null = null;
        let bestN = -1;
        for (const m of matches) {
          const n = Number(m.replace(/,/g, ""));
          if (n > bestN) {
            bestN = n;
            best = m;
          }
        }
        return best;
      }

      const coverImg = document.querySelector(
        "main img[src*='i.scdn.co']",
      ) as HTMLImageElement | null;
      const coverUrl = coverImg?.src ?? null;

      const rows = Array.from(
        document.querySelectorAll('[data-testid^="tracklist-row"]'),
      ) as HTMLElement[];
      const seen = new Set<string>();
      const tracks: {
        spotifyId: string;
        name: string;
        streams: string | null;
        albumImageUrl: string | null;
        isPrimary?: boolean;
      }[] = [];
      for (const row of rows) {
        const trackAnchor = row.querySelector(
          'a[href*="/track/"]',
        ) as HTMLAnchorElement | null;
        if (!trackAnchor) continue;
        const m = trackAnchor.href.match(/\/track\/([a-zA-Z0-9]{22})/);
        if (!m) continue;
        const id = m[1];
        if (seen.has(id)) continue;
        const name = (trackAnchor.textContent ?? "").trim();
        if (!name) continue;

        // Identify the first /artist/{id} anchor inside the row — that's the
        // primary. Also filter by credit if a target artist was specified.
        const artistAnchors = Array.from(
          row.querySelectorAll('a[href*="/artist/"]'),
        ) as HTMLAnchorElement[];
        const artistIds = artistAnchors
          .map((a) => a.href.match(/\/artist\/([a-zA-Z0-9]{22})/)?.[1])
          .filter((v): v is string => !!v);
        if (filterArtistId && !artistIds.includes(filterArtistId)) continue;
        const isPrimary = filterArtistId
          ? artistIds[0] === filterArtistId
          : undefined;

        const rowText = row.innerText ?? "";
        const withoutName = name ? rowText.split(name).join(" ") : rowText;
        const streamsText = biggestNumber(withoutName);
        tracks.push({
          spotifyId: id,
          name,
          streams: streamsText,
          albumImageUrl: coverUrl,
          isPrimary,
        });
        seen.add(id);
      }

      return { tracks };
    }, filterArtistSpotifyId ?? null);

    return {
      spotifyId: albumId,
      tracks: data.tracks.map((t) => ({
        spotifyId: t.spotifyId,
        name: t.name,
        streams: parseCount(t.streams),
        albumImageUrl: t.albumImageUrl,
      })),
    };
  } catch (e) {
    return {
      spotifyId: albumId,
      tracks: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ============================================================================
// Track-page scrape — the only place Spotify shows per-track play counts
// beyond the artist's top 10. Requires auth cookie.
// ============================================================================

export type ScrapedTrackStreams = {
  spotifyId: string;
  streams: number | null;
  error?: string;
};

export async function scrapeTrackStreams(
  spotifyIds: string[],
  opts: {
    spDc: string;
    concurrency?: number;
    onOne?: (done: number, total: number, r: ScrapedTrackStreams) => Promise<void> | void;
    browser?: Browser;
  },
): Promise<ScrapedTrackStreams[]> {
  if (spotifyIds.length === 0) return [];
  if (!opts.spDc) throw new Error("scrapeTrackStreams requires sp_dc");
  const concurrency = Math.max(1, opts.concurrency ?? 2);
  const browser = opts.browser ?? (await launchBrowser());
  const ownsBrowser = !opts.browser;
  try {
    const results: ScrapedTrackStreams[] = [];
    const queue = [...spotifyIds];
    let done = 0;
    const total = spotifyIds.length;

    async function worker() {
      while (queue.length) {
        const id = queue.shift();
        if (!id) return;
        const page = await browser.newPage();
        let result: ScrapedTrackStreams;
        try {
          await setupPage(page, opts.spDc);
          result = await scrapeTrackPage(page, id);
        } catch (e) {
          result = {
            spotifyId: id,
            streams: null,
            error: e instanceof Error ? e.message : String(e),
          };
        } finally {
          await page.close().catch(() => {});
        }
        results.push(result);
        done += 1;
        if (opts.onOne) await opts.onOne(done, total, result);
        // Light jitter — keep Spotify happy, stay under tab-limit
        await new Promise((r) => setTimeout(r, 250));
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(concurrency, total) }, () => worker()),
    );
    return results;
  } finally {
    if (ownsBrowser) await browser.close().catch(() => {});
  }
}

async function scrapeTrackPage(
  page: Page,
  spotifyId: string,
): Promise<ScrapedTrackStreams> {
  try {
    await page.goto(`https://open.spotify.com/track/${spotifyId}`, {
      waitUntil: "domcontentloaded",
      timeout: 25_000,
    });
    // The big play count is near the top of the hydrated page — wait for
    // anything number-looking or the play button to appear.
    await page
      .waitForFunction(
        () => /\d{1,3}(,\d{3})+|\d{5,}/.test(document.body.innerText),
        { timeout: 15_000 },
      )
      .catch(() => null);
    await dismissCookieBanner(page);
    await new Promise((r) => setTimeout(r, 1200));

    const data = await page.evaluate(() => {
      // Strategy: find the first big number in the hero area of the page
      // (before the "Popular" or "Recommended" recommendation tracklist).
      const body = document.body.innerText;
      // Cut off at any recommendation section — we want the current track's
      // play count, not the popular tracks' numbers we'd also see.
      const cutoffPoints = [
        body.indexOf("Popular"),
        body.indexOf("Recommended"),
        body.indexOf("Fans also"),
        body.indexOf("More by"),
        body.indexOf("Artist pick"),
      ].filter((i) => i >= 0);
      const cutoff = cutoffPoints.length ? Math.min(...cutoffPoints) : body.length;
      const hero = body.slice(0, cutoff).replace(/\d+:\d+/g, " ");
      const matches = hero.match(/\d{1,3}(?:,\d{3})+|\d{5,}/g);
      if (!matches || matches.length === 0) return { streamsText: null };
      // The first big number in the hero is the play count. Sometimes the
      // duration sneaks in even after cutoff; pick the LARGEST as backup.
      let best = matches[0];
      let bestN = Number(best.replace(/,/g, ""));
      for (const m of matches) {
        const n = Number(m.replace(/,/g, ""));
        if (n > bestN) {
          bestN = n;
          best = m;
        }
      }
      return { streamsText: best };
    });

    return {
      spotifyId,
      streams: parseCount(data.streamsText),
    };
  } catch (e) {
    return {
      spotifyId,
      streams: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ============================================================================
// Deep scrape — combine artist + album scrape into union of tracks per artist
// ============================================================================

export type DeepScrapeProgress = {
  phase: "artist" | "albums" | "done";
  artistId?: string;
  artistIndex: number;
  artistTotal: number;
  albumsScraped: number;
  albumsTotal: number;
};

export async function scrapeArtistsDeep(
  spotifyIds: string[],
  opts: {
    spDc: string;
    onProgress?: (p: DeepScrapeProgress) => void;
    concurrency?: number;
  },
): Promise<DeepScrapedArtist[]> {
  if (spotifyIds.length === 0) return [];
  const browser = await launchBrowser();
  try {
    // Phase 1: artist pages (sequentially to respect concurrency of album pages)
    const artistPages: ScrapedArtistPage[] = [];
    let idx = 0;
    for (const id of spotifyIds) {
      opts.onProgress?.({
        phase: "artist",
        artistId: id,
        artistIndex: idx,
        artistTotal: spotifyIds.length,
        albumsScraped: 0,
        albumsTotal: 0,
      });
      const page = await browser.newPage();
      try {
        await setupPage(page, opts.spDc);
        artistPages.push(await scrapeArtistPage(page, id));
      } finally {
        await page.close().catch(() => {});
      }
      idx += 1;
    }

    // Phase 2: albums for all artists
    const artistToAlbums = new Map<string, string[]>();
    const allAlbumIds = new Set<string>();
    for (const a of artistPages) {
      artistToAlbums.set(a.spotifyId, a.albumIds);
      for (const aid of a.albumIds) allAlbumIds.add(aid);
    }
    const albumIdList = Array.from(allAlbumIds);

    const albumResults = new Map<string, ScrapedAlbum>();
    let albumsDone = 0;
    const queue = [...albumIdList];
    async function albumWorker() {
      while (queue.length) {
        const aid = queue.shift();
        if (!aid) return;
        const page = await browser.newPage();
        try {
          await setupPage(page, opts.spDc);
          const r = await scrapeAlbumPage(page, aid);
          albumResults.set(aid, r);
        } finally {
          await page.close().catch(() => {});
        }
        albumsDone += 1;
        opts.onProgress?.({
          phase: "albums",
          artistIndex: spotifyIds.length,
          artistTotal: spotifyIds.length,
          albumsScraped: albumsDone,
          albumsTotal: albumIdList.length,
        });
      }
    }
    const concurrency = opts.concurrency ?? 4;
    await Promise.all(
      Array.from(
        { length: Math.min(concurrency, albumIdList.length || 1) },
        () => albumWorker(),
      ),
    );

    // Merge: for each artist, combine artist-page tracks + album-page tracks
    const out: DeepScrapedArtist[] = artistPages.map((a) => {
      const byTrack = new Map<string, ScrapedTrack>();
      for (const t of a.tracks) byTrack.set(t.spotifyId, t);
      const albums = artistToAlbums.get(a.spotifyId) ?? [];
      for (const aid of albums) {
        const album = albumResults.get(aid);
        if (!album) continue;
        for (const t of album.tracks) {
          const existing = byTrack.get(t.spotifyId);
          if (!existing) {
            byTrack.set(t.spotifyId, t);
          } else {
            // Prefer the higher stream count (in case either source was stale/missing)
            if ((t.streams ?? 0) > (existing.streams ?? 0)) {
              byTrack.set(t.spotifyId, { ...existing, streams: t.streams });
            }
          }
        }
      }
      return {
        spotifyId: a.spotifyId,
        monthlyListeners: a.monthlyListeners,
        tracks: Array.from(byTrack.values()),
        albumCount: albums.length,
        error: a.error,
      };
    });

    opts.onProgress?.({
      phase: "done",
      artistIndex: spotifyIds.length,
      artistTotal: spotifyIds.length,
      albumsScraped: albumsDone,
      albumsTotal: albumIdList.length,
    });

    return out;
  } finally {
    await browser.close().catch(() => {});
  }
}
