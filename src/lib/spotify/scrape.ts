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
  opts: { spDc?: string | null; concurrency?: number } = {},
): Promise<ScrapedArtistPage[]> {
  if (spotifyIds.length === 0) return [];
  const concurrency = opts.concurrency ?? 3;
  const browser = await launchBrowser();
  try {
    const results: ScrapedArtistPage[] = [];
    const queue = [...spotifyIds];
    async function worker() {
      while (queue.length) {
        const id = queue.shift();
        if (!id) return;
        const page = await browser.newPage();
        try {
          await setupPage(page, opts.spDc);
          results.push(await scrapeArtistPage(page, id));
        } finally {
          await page.close().catch(() => {});
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
): Promise<ScrapedArtistPage> {
  try {
    await page.goto(`https://open.spotify.com/artist/${spotifyId}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page
      .waitForSelector('[data-testid^="tracklist-row"]', { timeout: 15_000 })
      .catch(() => null);
    await dismissCookieBanner(page);

    // Scroll down so the discography section hydrates and lazy album cards render.
    await page
      .evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      .catch(() => {});
    await new Promise((r) => setTimeout(r, 2500));
    await page.evaluate(() => window.scrollTo(0, 400)).catch(() => {});
    await new Promise((r) => setTimeout(r, 1000));

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
        tracks.push({
          spotifyId: id,
          name,
          streams: streamsText,
          albumImageUrl: img?.src ?? null,
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

    return {
      spotifyId,
      monthlyListeners: parseCount(data.monthlyListenersText),
      tracks: data.tracks.map((t) => ({
        spotifyId: t.spotifyId,
        name: t.name,
        streams: parseCount(t.streams),
        albumImageUrl: t.albumImageUrl,
      })),
      albumIds: data.albumIds,
    };
  } catch (e) {
    return {
      spotifyId,
      monthlyListeners: null,
      tracks: [],
      albumIds: [],
      error: e instanceof Error ? e.message : String(e),
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
    /** If set, keep only tracks where row text contains this artist's name */
    filterArtistName?: string;
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
            await scrapeAlbumPage(page, id, opts.filterArtistName),
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
  filterArtistName?: string,
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

    const data = await page.evaluate((filterName: string | null) => {
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

        // If a filter artist name was passed, only keep tracks that credit them.
        // Matches against the row's text (which includes artist links beneath
        // the track name for multi-artist tracks).
        if (filterName) {
          const needle = filterName.toLowerCase();
          const hay = rowText.toLowerCase();
          if (!hay.includes(needle)) continue;
        }

        const withoutName = name ? rowText.split(name).join(" ") : rowText;
        const streamsText = biggestNumber(withoutName);
        tracks.push({
          spotifyId: id,
          name,
          streams: streamsText,
          albumImageUrl: coverUrl,
        });
        seen.add(id);
      }

      return { tracks };
    }, filterArtistName ?? null);

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
