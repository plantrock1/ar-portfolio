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
    /** Per-page wait for the "X monthly listeners" text to hydrate. */
    listenerTimeoutMs?: number;
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
          result = await scrapeArtistPage(
            page,
            id,
            opts.skipAlbums,
            opts.listenerTimeoutMs,
          );
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
  listenerTimeoutMs = 8_000,
): Promise<ScrapedArtistPage> {
  try {
    await page.goto(`https://open.spotify.com/artist/${spotifyId}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await dismissCookieBanner(page);

    // Wait for the artist's H1 to be present AND for "monthly listeners"
    // text to render. We anchor to the H1 so that a "featured artist" banner
    // hydrating earlier doesn't make the wait pass prematurely (the banner's
    // monthly-listeners text would otherwise satisfy a body-only check).
    await page
      .waitForFunction(
        () => {
          const h1 = document.querySelector("h1");
          if (!h1) return false;
          return /[\d,\.]+\s+monthly listeners/i.test(document.body.innerText);
        },
        { timeout: listenerTimeoutMs },
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
      // Spotify's artist page can render multiple "X monthly listeners"
      // strings: the artist's own (in the hero) plus banners, "fans also
      // like" cards, "discovered on" playlists, etc. The earlier H1-walk
      // approach was still fooled when the H1's ancestor's innerText
      // concatenated banner text that appeared earlier in DOM order.
      //
      // New approach:
      //   1. Walk the DOM as text nodes, collect every node whose own text
      //      matches the listener pattern (each match is one specific
      //      element, not concatenated parent text).
      //   2. Drop any whose ancestor chain hits a known promo/aside/related
      //      module (these are the false positives we keep seeing).
      //   3. Of what remains, pick the one whose container chain shares the
      //      most ancestors with the page <h1> — i.e. the listener text
      //      closest in the DOM to the artist's name.
      const ML_RE = /([\d,\.]+)\s+monthly listeners/i;
      // Subtrees we ignore when matching the artist's own listener count.
      // Notable additions for the now-playing bug: when the scraper auths
      // with the owner's sp_dc cookie, Spotify renders the currently-
      // playing track's artist metadata (incl. monthly listeners) inside
      // the persistent player bar + Now Playing View + friend activity
      // sidebar. Those numbers belong to whatever the *user* is listening
      // to, not the artist whose page we're on, so we exclude the entire
      // chrome of the app from the candidate pool.
      const PROMO_SELECTOR = [
        // Layout chrome
        "aside",
        "footer",
        "nav",
        '[role="banner"]',
        '[role="complementary"]',
        '[role="contentinfo"]',
        // Recommended-artists / related modules within the artist page
        '[data-testid*="featured"]',
        '[data-testid*="promo"]',
        '[data-testid*="similar-artists"]',
        '[data-testid*="fans-also-like"]',
        '[data-testid*="discovered-on"]',
        '[data-testid*="related"]',
        '[data-testid*="recommendation"]',
        // Persistent player + Now Playing UI (the now-playing-bug source)
        '[data-testid*="now-playing"]',
        '[data-testid*="now_playing"]',
        '[data-testid*="player"]',
        '[data-testid*="playback"]',
        '[data-testid*="buddy-feed"]',
        '[data-testid*="friend-activity"]',
        '[aria-label*="Now playing" i]',
        '[aria-label*="now-playing" i]',
        '[aria-label*="player" i]',
        // Tooltips / hover cards that can render artist metadata
        '[role="tooltip"]',
        '[data-testid*="tooltip"]',
        '[data-testid*="hovercard"]',
      ].join(", ");

      type Cand = { el: HTMLElement; value: string };
      const candidates: Cand[] = [];
      // Walk all elements, but keep only "leaf-ish" containers whose total
      // textContent is short — these are real listener-count nodes, not
      // wrapping ancestors. Cap at 120 chars so "459,355 monthly listeners"
      // (~30 chars) easily fits but the entire hero section (~hundreds)
      // doesn't. Important: react sometimes splits the number and the words
      // across sibling spans, so we can't just walk text nodes.
      const all = document.querySelectorAll<HTMLElement>("*");
      for (const el of all) {
        const text = (el.textContent ?? "").trim();
        if (text.length > 120) continue;
        const m = text.match(ML_RE);
        if (!m) continue;
        candidates.push({ el, value: m[1] });
      }
      // Multiple ancestors of a leaf will all match (each accumulates the
      // child's text into its own textContent). Dedupe to the deepest match
      // for each unique value-position by keeping only candidates that have
      // no other candidate as a descendant. (i.e. closest-to-text wins.)
      const deepest = candidates.filter(
        (c, _i, arr) =>
          !arr.some(
            (other) => other !== c && c.el.contains(other.el),
          ),
      );

      const safe = deepest.filter((c) => !c.el.closest(PROMO_SELECTOR));
      const pool = safe.length > 0 ? safe : deepest;

      let monthlyListenersText: string | null = null;
      const h1 = document.querySelector("h1") as HTMLElement | null;
      if (pool.length > 0 && h1) {
        // Pick the candidate whose nearest common ancestor with H1 is the
        // shallowest (= closest in DOM tree distance).
        let best: Cand | null = null;
        let bestDist = Infinity;
        for (const c of pool) {
          let p: HTMLElement | null = c.el;
          let d = 0;
          while (p && !p.contains(h1)) {
            p = p.parentElement;
            d++;
            if (d > 30) break; // give up if we'd walk to <html>
          }
          if (p && d < bestDist) {
            bestDist = d;
            best = c;
          }
        }
        monthlyListenersText = best ? best.value : pool[0].value;
      } else if (pool.length > 0) {
        monthlyListenersText = pool[0].value;
      }

      // Last-resort fallback (no candidates at all).
      if (!monthlyListenersText) {
        const m = document.body.innerText.match(ML_RE);
        monthlyListenersText = m ? m[1] : null;
      }

      // Diagnostic dump: emit one structured line we can parse from GHA
      // logs to see *every* candidate when the wrong number gets picked.
      // describePath returns a short DOM signature so we can identify the
      // container without dumping huge HTML blobs.
      function describePath(el: HTMLElement | null): string {
        if (!el) return "?";
        const parts: string[] = [];
        let cur: HTMLElement | null = el;
        for (let i = 0; cur && i < 6; i++) {
          let part = cur.tagName.toLowerCase();
          const tid = cur.getAttribute("data-testid");
          if (tid) part += `[testid=${tid}]`;
          const role = cur.getAttribute("role");
          if (role) part += `[role=${role}]`;
          const aria = cur.getAttribute("aria-label");
          if (aria) part += `[aria=${aria.slice(0, 30)}]`;
          parts.unshift(part);
          cur = cur.parentElement;
        }
        return parts.join(">");
      }
      const rejected = deepest.filter((c) => c.el.closest(PROMO_SELECTOR));
      const monthlyListenersDebug = {
        chosen: monthlyListenersText,
        candidates: pool.length,
        candidatesAll: candidates.length,
        promoFiltered: rejected.length,
        details: pool.slice(0, 6).map((c) => ({
          value: c.value,
          path: describePath(c.el),
        })),
        // Rejected candidates so we can see if the artist's actual hero
        // got incorrectly filtered out — that's the silent-failure case.
        rejectedDetails: rejected.slice(0, 6).map((c) => ({
          value: c.value,
          path: describePath(c.el),
        })),
      };

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
        monthlyListenersDebug,
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
    } else if (data.monthlyListenersDebug) {
      // Log every artist's pick context, not just multi-candidate ones.
      // Single-candidate cases are exactly the silent-failure mode we hit
      // with Tiffany Nacol — the filter was too aggressive and left only
      // a wrong number, with no log line to tell us where it came from.
      const dbg = data.monthlyListenersDebug;
      const lines = [
        `[scrape] ${spotifyId} chose ${dbg.chosen} from ${dbg.candidates} candidates ` +
          `(${dbg.promoFiltered} dropped by promo filter, ${dbg.candidatesAll} total raw):`,
        ...dbg.details.map(
          (d: { value: string; path: string }) =>
            `  ✓ ${d.value}  @  ${d.path}`,
        ),
        ...dbg.rejectedDetails.map(
          (d: { value: string; path: string }) =>
            `  ✗ ${d.value}  @  ${d.path}`,
        ),
      ];
      console.warn(lines.join("\n"));
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
