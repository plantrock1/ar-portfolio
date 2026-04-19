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

export type ScrapedTrack = {
  spotifyId: string;
  name: string;
  streams: number | null;
  albumImageUrl: string | null;
};

export type ScrapedArtist = {
  spotifyId: string;
  monthlyListeners: number | null;
  tracks: ScrapedTrack[];
  error?: string;
};

export async function scrapeArtists(
  spotifyIds: string[],
  opts: { concurrency?: number } = {},
): Promise<ScrapedArtist[]> {
  if (spotifyIds.length === 0) return [];
  const concurrency = opts.concurrency ?? 3;
  const browser = await launchBrowser();
  try {
    const results: ScrapedArtist[] = [];
    const queue = [...spotifyIds];
    async function worker() {
      while (queue.length) {
        const id = queue.shift();
        if (!id) return;
        results.push(await scrapeOne(browser, id));
      }
    }
    const workers = Array.from(
      { length: Math.min(concurrency, spotifyIds.length) },
      () => worker(),
    );
    await Promise.all(workers);
    return results;
  } finally {
    await browser.close().catch(() => {});
  }
}

function parseCount(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/[,\.\s]/g, "");
  // handles things like "1.8M" or "304K" — rare here, Spotify shows full numbers
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

async function scrapeOne(
  browser: Browser,
  spotifyId: string,
): Promise<ScrapedArtist> {
  const page: Page = await browser.newPage();
  try {
    await applyStealth(page);
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    );
    await page.setViewport({ width: 1366, height: 800 });
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    await page.goto(`https://open.spotify.com/artist/${spotifyId}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    // Wait for the tracklist rows to appear — that's when streams hydrate.
    await page
      .waitForSelector('[data-testid^="tracklist-row"]', { timeout: 15_000 })
      .catch(() => null);

    // Dismiss cookie banner if present
    await page
      .evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button"));
        const accept = btns.find((b) =>
          /accept|agree|ok/i.test(b.textContent ?? ""),
        );
        if (accept) (accept as HTMLButtonElement).click();
      })
      .catch(() => {});

    // Small scroll + wait — streams lazy-load after tracklist mount.
    await page.evaluate(() => window.scrollTo(0, 400)).catch(() => {});
    await new Promise((r) => setTimeout(r, 2500));

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

      return { monthlyListenersText, tracks };
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
    };
  } catch (e) {
    return {
      spotifyId,
      monthlyListeners: null,
      tracks: [],
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    await page.close().catch(() => {});
  }
}
