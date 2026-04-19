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
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }

  const chromium = (await import("@sparticuz/chromium")).default as unknown as {
    args: string[];
    defaultViewport?: { width: number; height: number; deviceScaleFactor?: number };
    executablePath: () => Promise<string>;
  };
  return puppeteer.default.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
}

export type ScrapedTrack = {
  spotifyId: string;
  name: string;
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
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    await page.goto(`https://open.spotify.com/artist/${spotifyId}`, {
      waitUntil: "domcontentloaded",
      timeout: 25_000,
    });

    // Wait for monthly listeners — signal that React has hydrated
    await page.waitForFunction(
      () => /[\d,\.]+\s+monthly listeners/i.test(document.body.innerText),
      { timeout: 15_000 },
    );

    // Anonymous Spotify page renders only monthly listeners + track titles.
    // Followers and play counts are gated to logged-in users, so we don't
    // attempt to extract them here.
    const data = await page.evaluate(() => {
      const body = document.body.innerText;
      const mlMatch = body.match(/([\d,\.]+)\s+monthly listeners/i);
      const monthlyListenersText = mlMatch ? mlMatch[1] : null;

      const trackAnchors = Array.from(
        document.querySelectorAll('a[href*="/track/"]'),
      ) as HTMLAnchorElement[];

      const seen = new Set<string>();
      const tracks: {
        spotifyId: string;
        name: string;
        albumImageUrl: string | null;
      }[] = [];

      for (const a of trackAnchors) {
        const m = a.href.match(/\/track\/([a-zA-Z0-9]{22})/);
        if (!m) continue;
        const id = m[1];
        if (seen.has(id)) continue;
        const name = (a.textContent ?? "").trim();
        if (!name) continue;

        // Walk up to find the row element for the album image
        let row: HTMLElement | null = a;
        for (let i = 0; i < 8 && row?.parentElement; i++) {
          row = row.parentElement;
          const testid = row.getAttribute("data-testid") ?? "";
          if (testid.startsWith("tracklist-row")) break;
        }
        const img = row?.querySelector("img") as HTMLImageElement | null;

        tracks.push({ spotifyId: id, name, albumImageUrl: img?.src ?? null });
        seen.add(id);
        if (tracks.length >= 10) break;
      }

      return { monthlyListenersText, tracks };
    });

    return {
      spotifyId,
      monthlyListeners: parseCount(data.monthlyListenersText),
      tracks: data.tracks,
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
